/*
<MODULE_CONTRACT>
<purpose>Git init, commit, and push helpers for exported repos.</purpose>
<non-goals>
  <item>Does not implement AI commit message generation (see changelog.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial git helpers for RFC-0070. Ported commitExport from scripts/export-clients.ts.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { GitConfig } from "../types.js";

export async function commitExport(
  dest: string,
  commitMessage: string,
  gitConfig?: GitConfig,
): Promise<void> {
  console.log("");
  console.log("Committing changes in destination repository...");
  try {
    const gitDir = path.join(dest, ".git");
    if (!existsSync(gitDir)) {
      console.log("  initializing git repository...");
      execSync("git init -b main", { cwd: dest, stdio: "pipe" });
    } else {
      const branch = execSync("git branch --show-current", { cwd: dest, stdio: "pipe" })
        .toString()
        .trim();
      if (branch && branch !== "main") {
        execSync("git branch -m main", { cwd: dest, stdio: "pipe" });
        console.log(`  renamed branch: ${branch} → main`);
      }
    }

    if (gitConfig?.remote) {
      try {
        const remoteUrl = execSync("git remote get-url origin", {
          cwd: dest,
          stdio: "pipe",
        })
          .toString()
          .trim();
        if (remoteUrl !== gitConfig.remote) {
          execSync(`git remote set-url origin ${gitConfig.remote}`, { cwd: dest, stdio: "pipe" });
          console.log(`  updated origin remote: ${gitConfig.remote}`);
        }
      } catch {
        execSync(`git remote add origin ${gitConfig.remote}`, { cwd: dest, stdio: "pipe" });
        console.log(`  added origin remote: ${gitConfig.remote}`);
      }
    }

    execSync("git add -A", { cwd: dest, stdio: "pipe" });
    const status = execSync("git status --porcelain", { cwd: dest, stdio: "pipe" })
      .toString()
      .trim();
    if (status) {
      execSync(`git commit -m "${commitMessage}"`, { cwd: dest, stdio: "inherit" });
      console.log(`  committed: ${commitMessage}`);
    } else {
      console.log("  nothing to commit");
    }

    if (gitConfig?.remote && gitConfig.autoPush) {
      console.log("Pushing to origin...");
      try {
        const branch = execSync("git branch --show-current", { cwd: dest, stdio: "pipe" })
          .toString()
          .trim();
        if (!branch) {
          console.log("  skipped (no branch to push)");
          return;
        }
        try {
          execSync(`git push -u origin ${branch}`, { cwd: dest, stdio: "inherit" });
          console.log(`  pushed to origin/${branch}`);
        } catch {
          console.log("  regular push rejected, retrying with --force...");
          execSync(`git push -u --force origin ${branch}`, { cwd: dest, stdio: "inherit" });
          console.log(`  force-pushed to origin/${branch}`);
        }
      } catch (pushErr) {
        console.error("  push failed:", pushErr instanceof Error ? pushErr.message : pushErr);
        console.error("  commit is saved locally — push manually when SSH is available");
      }
    }
  } catch (err) {
    console.log("  git commit skipped (not a git repository or no changes)", err);
  }
}

export function getLastExportDate(dest: string): string | null {
  try {
    const dateStr = execSync("git log -1 --format=%ad --date=format:%Y-%m-%d", {
      cwd: dest,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return dateStr || null;
  } catch {
    return null;
  }
}

export function diffSummary(dest: string): string | null {
  try {
    const nameStatus = execSync("git diff --cached --name-status", {
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
