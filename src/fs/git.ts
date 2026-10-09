/*
<MODULE_CONTRACT>
<purpose>Git init, commit, and push helpers for exported repos. for reliable use by its direct callers and maintainers.</purpose>
<non-goals>
  <item>Does not implement AI commit message generation (see changelog.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial git helpers for RFC-0070. Ported commitExport from scripts/export-clients.ts.</item>
  <item>RFC-0073: replaced all execSync with execFileSync (argument arrays) to eliminate shell injection.</item>
  <item>RFC-0074: Wrapped execFileSync calls with GitOperationError. Changed commitExport return to { committed, pushed }.</item>
  <item>RFC-0075: Added Windows multi-prefix guard in transferGitHistory().</item>
  <item>RFC-0131: Added assertCleanSource (dirty preflight), materializeHeadWorktree (--from-head), and git.autoReconcile ours-merge retry in commitExport.</item>
</CHANGE_SUMMARY>
*/

import { existsSync, rmSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import type { GitConfig } from "../types.js";
import type { Logger } from "../log.js";
import { GitOperationError } from "../errors.js";

export async function commitExport(
  dest: string,
  commitMessage: string,
  gitConfig?: GitConfig,
  logger?: Logger,
): Promise<{ committed: boolean; pushed: boolean }> {
  const log = logger?.log ?? console.log;
  const error = logger?.error ?? console.error;
  log("");
  log("Committing changes in destination repository...");
  let committed = false;
  let pushed = false;
  try {
    const gitDir = path.join(dest, ".git");
    if (!existsSync(gitDir)) {
      log("  initializing git repository...");
      try {
        execFileSync("git", ["init", "-b", "main"], { cwd: dest, stdio: "pipe" });
      } catch (err) {
        throw new GitOperationError(
          "init",
          (err instanceof Error ? err.message : String(err)).slice(0, 200),
          err instanceof Error ? err : undefined,
        );
      }
    } else {
      const branch = execFileSync("git", ["branch", "--show-current"], { cwd: dest, stdio: "pipe" })
        .toString()
        .trim();
      if (branch && branch !== "main") {
        execFileSync("git", ["branch", "-m", "main"], { cwd: dest, stdio: "pipe" });
        log(`  renamed branch: ${branch} → main`);
      }
    }

    if (gitConfig?.remote) {
      try {
        const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
          cwd: dest,
          stdio: "pipe",
        })
          .toString()
          .trim();
        if (remoteUrl !== gitConfig.remote) {
          execFileSync("git", ["remote", "set-url", "origin", gitConfig.remote], {
            cwd: dest,
            stdio: "pipe",
          });
          log(`  updated origin remote: ${gitConfig.remote}`);
        }
      } catch {
        execFileSync("git", ["remote", "add", "origin", gitConfig.remote], {
          cwd: dest,
          stdio: "pipe",
        });
        log(`  added origin remote: ${gitConfig.remote}`);
      }
    }

    execFileSync("git", ["add", "-A"], { cwd: dest, stdio: "pipe" });
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dest, stdio: "pipe" })
      .toString()
      .trim();
    if (status) {
      execFileSync("git", ["commit", "-m", commitMessage], { cwd: dest, stdio: "inherit" });
      log(`  committed: ${commitMessage}`);
      committed = true;
    } else {
      log("  nothing to commit");
    }

    if (gitConfig?.remote && gitConfig.autoPush) {
      log("Pushing to origin...");
      try {
        const branch = execFileSync("git", ["branch", "--show-current"], {
          cwd: dest,
          stdio: "pipe",
        })
          .toString()
          .trim();
        if (!branch) {
          log("  skipped (no branch to push)");
          return { committed, pushed };
        }
        const tryPush = (): { ok: boolean; stderr: string } => {
          try {
            execFileSync("git", ["push", "-u", "origin", branch], { cwd: dest, stdio: "pipe" });
            return { ok: true, stderr: "" };
          } catch (e) {
            const stderr =
              e instanceof Error && "stderr" in e
                ? String((e as { stderr?: Buffer | string }).stderr ?? e.message)
                : String(e);
            return { ok: false, stderr };
          }
        };
        const attempt = tryPush();
        if (attempt.ok) {
          log(`  pushed to origin/${branch}`);
          pushed = true;
        } else if (
          gitConfig.autoReconcile &&
          /non-fast-forward|\(fetch first\)|\[rejected\]/i.test(attempt.stderr)
        ) {
          // RFC-0131: opt-in reconcile — fetch + merge -s ours + retry once.
          // Fires only on non-fast-forward rejections; auth/hook/transient
          // failures take the manual path. The local tree is the authoritative
          // export; remote history is preserved, its tree state is not adopted.
          error(`  push rejected (non-fast-forward) — reconciling via merge -s ours`);
          try {
            execFileSync("git", ["fetch", "origin"], { cwd: dest, stdio: "pipe" });
            execFileSync(
              "git",
              [
                "merge",
                "-s",
                "ours",
                `origin/${branch}`,
                "-m",
                "merge: reconcile remote export history (local tree is authoritative export)",
              ],
              { cwd: dest, stdio: "inherit" },
            );
            const retry = tryPush();
            if (retry.ok) {
              log(`  pushed to origin/${branch} after reconcile`);
              pushed = true;
            } else {
              error(`  push after reconcile failed: ${retry.stderr.trim().slice(0, 500)}`);
              error("  commit is saved locally — resolve manually, then push.");
            }
          } catch (reconcileErr) {
            error(
              `  reconcile failed: ${reconcileErr instanceof Error ? reconcileErr.message : reconcileErr}`,
            );
            error("  commit is saved locally — resolve manually, then push.");
          }
        } else {
          error(`  push rejected: ${attempt.stderr.trim().slice(0, 500)}`);
          error("  remote has diverged — commit is saved locally.");
          error("  resolve manually: pull remote changes, merge, then push.");
        }
      } catch (pushErr) {
        error(`  push failed: ${pushErr instanceof Error ? pushErr.message : pushErr}`);
        error("  commit is saved locally — push manually when SSH is available");
      }
    }
  } catch (err) {
    if (err instanceof GitOperationError) throw err;
    log("  git commit skipped (not a git repository or no changes)");
  }
  return { committed, pushed };
}

/**
 * RFC-0131: collect uncommitted changes (modified, staged, untracked) under the
 * given repo-relative dirs, grouped by status letter. Returns an empty map for
 * non-git roots — there is no HEAD to be dirty against.
 */
export function collectDirtyFiles(root: string, dirs: string[]): Map<string, string[]> {
  const byStatus = new Map<string, string[]>();
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, stdio: "pipe" });
  } catch {
    return byStatus;
  }
  const uniqueDirs = [...new Set(dirs.filter(Boolean))];
  if (!uniqueDirs.length) return byStatus;
  const out = execFileSync("git", ["status", "--porcelain", "--", ...uniqueDirs], {
    cwd: root,
    stdio: "pipe",
  })
    .toString()
    .trim();
  for (const line of out.split("\n")) {
    if (!line) continue;
    const letter = line.slice(0, 2).trim() || "??";
    const file = line.slice(3);
    byStatus.set(letter, [...(byStatus.get(letter) ?? []), file]);
  }
  return byStatus;
}

const DIRTY_PREFLIGHT_LIMIT = 20;

/**
 * RFC-0131: fail-closed dirty-source preflight. Throws GitOperationError when
 * any of the given repo-relative dirs carries uncommitted changes. The offender
 * list is bounded and grouped by status letter.
 */
export function assertCleanSource(root: string, dirs: string[], logger?: Logger): void {
  const log = logger?.log ?? console.log;
  const dirty = collectDirtyFiles(root, dirs);
  if (!dirty.size) return;
  const lines: string[] = [];
  for (const [letter, files] of dirty) {
    for (const file of files) lines.push(`${letter} ${file}`);
  }
  const shown = lines.slice(0, DIRTY_PREFLIGHT_LIMIT);
  const suffix =
    lines.length > DIRTY_PREFLIGHT_LIMIT ? ` … +${lines.length - DIRTY_PREFLIGHT_LIMIT}` : "";
  log("  preflight: uncommitted changes in exported sources:");
  for (const line of shown) log(`    ${line}`);
  throw new GitOperationError(
    "preflight",
    `exported sources have uncommitted changes: ${shown.join(", ")}${suffix} — commit them, export --from-head, or pass --allow-dirty`,
  );
}

/**
 * RFC-0131: materialize a temporary git worktree at `ref` so the export reads
 * committed content instead of the ambient working tree. Returns the worktree
 * path plus a cleanup that removes it (`git worktree remove --force`).
 */
export async function materializeHeadWorktree(
  root: string,
  ref: string,
  logger?: Logger,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const log = logger?.log ?? console.log;
  let sha: string;
  try {
    sha = execFileSync("git", ["rev-parse", ref], { cwd: root, stdio: "pipe" }).toString().trim();
  } catch (err) {
    throw new GitOperationError(
      "worktree",
      `cannot resolve ref "${ref}": ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err : undefined,
    );
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "repo-extract-head-"));
  try {
    execFileSync("git", ["worktree", "add", "--detach", dir, sha], { cwd: root, stdio: "pipe" });
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new GitOperationError(
      "worktree",
      `git worktree add failed: ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err : undefined,
    );
  }
  log(`  source worktree: ${dir} @ ${sha.slice(0, 9)}`);
  return {
    dir,
    cleanup: async () => {
      try {
        execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: root, stdio: "pipe" });
      } catch {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

export function getLastExportDate(dest: string): string | null {
  try {
    const dateStr = execFileSync("git", ["log", "-1", "--format=%ad", "--date=format:%Y-%m-%d"], {
      cwd: dest,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return dateStr || null;
  } catch {
    return null;
  }
}

export async function transferGitHistory(
  root: string,
  dest: string,
  pathPrefixes: string[],
  logger?: Logger,
): Promise<boolean> {
  const log = logger?.log ?? console.log;
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd: root, stdio: "pipe" });
  } catch {
    log("  source is not a git repository, skipping history transfer");
    return false;
  }

  log(`Transferring git history for paths: ${pathPrefixes.join(", ")}...`);

  if (process.platform === "win32" && pathPrefixes.length > 1) {
    throw new Error(
      "Multi-prefix git history transfer is not supported on Windows. " +
        "Use WSL or Git Bash, or export with a single path prefix.",
    );
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "repo-extract-history-"));

  try {
    try {
      execFileSync("git", ["clone", "--no-hardlinks", root, tmpDir], {
        stdio: "pipe",
      });
    } catch (err) {
      throw new GitOperationError(
        "clone",
        (err instanceof Error ? err.message : String(err)).slice(0, 200),
        err instanceof Error ? err : undefined,
      );
    }

    try {
      execFileSync("git", ["reset", "--hard"], { cwd: tmpDir, stdio: "pipe" });
    } catch (err) {
      throw new GitOperationError(
        "reset",
        (err instanceof Error ? err.message : String(err)).slice(0, 200),
        err instanceof Error ? err : undefined,
      );
    }

    const env = { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: "1" };

    if (pathPrefixes.length === 1) {
      try {
        execFileSync(
          "git",
          [
            "filter-branch",
            "-f",
            "--prune-empty",
            "--subdirectory-filter",
            pathPrefixes[0],
            "--",
            "--all",
          ],
          { cwd: tmpDir, stdio: "pipe", env },
        );
      } catch (err) {
        throw new GitOperationError(
          "filter-branch",
          (err instanceof Error ? err.message : String(err)).slice(0, 200),
          err instanceof Error ? err : undefined,
        );
      }
    } else {
      const keepPattern = pathPrefixes
        .map((p) => `^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`)
        .join("|");
      const indexFilter = `git ls-files | grep -vE '${keepPattern.replace(/'/g, "'\\''")}' | xargs -r git rm -r --cached --ignore-unmatch --quiet --`;
      try {
        execFileSync(
          "git",
          ["filter-branch", "-f", "--prune-empty", "--index-filter", indexFilter, "--", "--all"],
          { cwd: tmpDir, stdio: "pipe", env },
        );
      } catch (err) {
        throw new GitOperationError(
          "filter-branch",
          (err instanceof Error ? err.message : String(err)).slice(0, 200),
          err instanceof Error ? err : undefined,
        );
      }
    }

    const destGit = path.join(dest, ".git");
    if (existsSync(destGit)) {
      rmSync(destGit, { recursive: true, force: true });
    }
    await cp(path.join(tmpDir, ".git"), destGit, { recursive: true });

    log("  git history transferred");
    return true;
  } catch (err) {
    log("  git history transfer failed, continuing with fresh repo");
    log(`  ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    return false;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function diffSummary(dest: string): string | null {
  try {
    const nameStatus = execFileSync("git", ["diff", "--cached", "--name-status"], {
      cwd: dest,
      stdio: "pipe",
    })
      .toString()
      .trim();
    if (!nameStatus) return null;

    const lines = nameStatus.split("\n");
    const added = lines.filter((l) => l.startsWith("A")).length;
    const modified = lines.filter((l) => l.startsWith("M")).length;
    const deleted = lines.filter((l) => l.startsWith("D")).length;
    const renamed = lines.filter((l) => l.startsWith("R")).length;

    const paths = lines.slice(0, 20).map((l) => {
      const parts = l.split("\t");
      const filePath = parts[parts.length - 1];
      const segments = filePath.split("/");
      return segments.slice(0, 3).join("/");
    });
    const uniquePaths = [...new Set(paths)].slice(0, 5);

    const parts: string[] = [];
    if (added) parts.push(`+${added}`);
    if (modified) parts.push(`~${modified}`);
    if (deleted) parts.push(`-${deleted}`);
    if (renamed) parts.push(`→${renamed}`);

    const statPart = parts.join(" ");
    const pathPart = uniquePaths.join(", ");
    return pathPart ? `${statPart} files (${pathPart})` : `${statPart} files`;
  } catch {
    return null;
  }
}
