/*
<MODULE_CONTRACT>
<purpose>Git init, commit, and push helpers for exported repos.</purpose>
<non-goals>
  <item>Does not implement AI commit message generation (see changelog.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial git helpers for RFC-0070. Ported commitExport from scripts/export-clients.ts.</item>
  <item>RFC-0073: replaced all execSync with execFileSync (argument arrays) to eliminate shell injection.</item>
  <item>RFC-0074: Wrapped execFileSync calls with GitOperationError. Changed commitExport return to { committed, pushed }.</item>
</CHANGE_SUMMARY>
*/

import { existsSync, rmSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import type { GitConfig } from "../types.js";
import { GitOperationError } from "../errors.js";

export async function commitExport(
  dest: string,
  commitMessage: string,
  gitConfig?: GitConfig,
): Promise<{ committed: boolean; pushed: boolean }> {
  console.log("");
  console.log("Committing changes in destination repository...");
  let committed = false;
  let pushed = false;
  try {
    const gitDir = path.join(dest, ".git");
    if (!existsSync(gitDir)) {
      console.log("  initializing git repository...");
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
        console.log(`  renamed branch: ${branch} → main`);
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
          console.log(`  updated origin remote: ${gitConfig.remote}`);
        }
      } catch {
        execFileSync("git", ["remote", "add", "origin", gitConfig.remote], {
          cwd: dest,
          stdio: "pipe",
        });
        console.log(`  added origin remote: ${gitConfig.remote}`);
      }
    }

    execFileSync("git", ["add", "-A"], { cwd: dest, stdio: "pipe" });
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dest, stdio: "pipe" })
      .toString()
      .trim();
    if (status) {
      execFileSync("git", ["commit", "-m", commitMessage], { cwd: dest, stdio: "inherit" });
      console.log(`  committed: ${commitMessage}`);
      committed = true;
    } else {
      console.log("  nothing to commit");
    }

    if (gitConfig?.remote && gitConfig.autoPush) {
      console.log("Pushing to origin...");
      try {
        const branch = execFileSync("git", ["branch", "--show-current"], {
          cwd: dest,
          stdio: "pipe",
        })
          .toString()
          .trim();
        if (!branch) {
          console.log("  skipped (no branch to push)");
          return { committed, pushed };
        }
        try {
          execFileSync("git", ["push", "-u", "origin", branch], { cwd: dest, stdio: "inherit" });
          console.log(`  pushed to origin/${branch}`);
          pushed = true;
        } catch {
          console.log("  regular push rejected, retrying with --force...");
          execFileSync("git", ["push", "-u", "--force", "origin", branch], {
            cwd: dest,
            stdio: "inherit",
          });
          console.log(`  force-pushed to origin/${branch}`);
          pushed = true;
        }
      } catch (pushErr) {
        console.error("  push failed:", pushErr instanceof Error ? pushErr.message : pushErr);
        console.error("  commit is saved locally — push manually when SSH is available");
      }
    }
  } catch (err) {
    if (err instanceof GitOperationError) throw err;
    console.log("  git commit skipped (not a git repository or no changes)", err);
  }
  return { committed, pushed };
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
): Promise<boolean> {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd: root, stdio: "pipe" });
  } catch {
    console.log("  source is not a git repository, skipping history transfer");
    return false;
  }

  console.log(`Transferring git history for paths: ${pathPrefixes.join(", ")}...`);

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

    console.log("  git history transferred");
    return true;
  } catch (err) {
    console.log("  git history transfer failed, continuing with fresh repo");
    console.log(`  ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
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
