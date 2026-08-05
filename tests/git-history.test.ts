import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import * as path from "node:path";
import * as os from "node:os";
import { transferGitHistory } from "../src/fs/git.js";

let tmpRoot: string;
let tmpDest: string;

beforeEach(async () => {
  tmpRoot = path.join(
    os.tmpdir(),
    `repo-extract-git-root-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  tmpDest = path.join(
    os.tmpdir(),
    `repo-extract-git-dest-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpRoot, { recursive: true });
  await mkdir(tmpDest, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  await rm(tmpDest, { recursive: true, force: true });
});

function gitInit(cwd: string): void {
  execSync("git init -b main", { cwd, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd, stdio: "pipe" });
  execSync("git config user.name Test", { cwd, stdio: "pipe" });
}

function gitCommit(cwd: string, msg: string): void {
  execSync("git add -A", { cwd, stdio: "pipe" });
  execSync(`git commit -m "${msg}"`, { cwd, stdio: "pipe" });
}

describe("transferGitHistory", () => {
  it("transfers history for a single path prefix using subdirectory-filter", async () => {
    gitInit(tmpRoot);

    await mkdir(path.join(tmpRoot, "packages/my-pkg/src"), { recursive: true });
    await writeFile(path.join(tmpRoot, "packages/my-pkg/src/index.ts"), "export const v = 1;\n");
    gitCommit(tmpRoot, "init my-pkg");

    await mkdir(path.join(tmpRoot, "apps/other"), { recursive: true });
    await writeFile(path.join(tmpRoot, "apps/other/main.ts"), "console.log('other');\n");
    gitCommit(tmpRoot, "add other app");

    await writeFile(path.join(tmpRoot, "packages/my-pkg/src/index.ts"), "export const v = 2;\n");
    gitCommit(tmpRoot, "update my-pkg");

    await mkdir(path.join(tmpDest, "src"), { recursive: true });
    await writeFile(path.join(tmpDest, "src/index.ts"), "export const v = 2;\n");

    const result = await transferGitHistory(tmpRoot, tmpDest, ["packages/my-pkg"]);

    expect(result).toBe(true);

    const log = execSync("git log --oneline", { cwd: tmpDest, encoding: "utf-8" }).trim();
    const lines = log.split("\n");
    expect(lines.length).toBe(2);
    expect(log).toContain("init my-pkg");
    expect(log).toContain("update my-pkg");
    expect(log).not.toContain("add other app");
  });

  it("transfers history for multiple path prefixes", async () => {
    gitInit(tmpRoot);

    await mkdir(path.join(tmpRoot, "packages/pkg-a/src"), { recursive: true });
    await writeFile(path.join(tmpRoot, "packages/pkg-a/src/index.ts"), "export const a = 1;\n");
    gitCommit(tmpRoot, "init pkg-a");

    await mkdir(path.join(tmpRoot, "packages/pkg-b/src"), { recursive: true });
    await writeFile(path.join(tmpRoot, "packages/pkg-b/src/index.ts"), "export const b = 1;\n");
    gitCommit(tmpRoot, "init pkg-b");

    await mkdir(path.join(tmpRoot, "apps/unrelated"), { recursive: true });
    await writeFile(path.join(tmpRoot, "apps/unrelated/main.ts"), "console.log('x');\n");
    gitCommit(tmpRoot, "add unrelated app");

    await mkdir(path.join(tmpDest, "packages/pkg-a/src"), { recursive: true });
    await mkdir(path.join(tmpDest, "packages/pkg-b/src"), { recursive: true });
    await writeFile(path.join(tmpDest, "packages/pkg-a/src/index.ts"), "export const a = 1;\n");
    await writeFile(path.join(tmpDest, "packages/pkg-b/src/index.ts"), "export const b = 1;\n");

    const result = await transferGitHistory(tmpRoot, tmpDest, [
      "packages/pkg-a",
      "packages/pkg-b",
    ]);

    expect(result).toBe(true);

    const log = execSync("git log --oneline", { cwd: tmpDest, encoding: "utf-8" }).trim();
    expect(log).toContain("init pkg-a");
    expect(log).toContain("init pkg-b");
    expect(log).not.toContain("add unrelated app");
  });

  it("returns false when source is not a git repository", async () => {
    const result = await transferGitHistory(tmpRoot, tmpDest, ["packages/my-pkg"]);
    expect(result).toBe(false);
  });
});
