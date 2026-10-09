import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { execSync, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  assertCleanSource,
  commitExport,
  materializeHeadWorktree,
} from "../src/fs/git.js";
import { GitOperationError } from "../src/errors.js";
import { extractProject } from "../src/extract.js";
import type { ExtractConfig } from "../src/types.js";

let tmpRoot: string;
let tmpDest: string;
let tmpRemote: string;

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  tmpRoot = path.join(os.tmpdir(), `repo-extract-cs-root-${stamp}`);
  tmpDest = path.join(os.tmpdir(), `repo-extract-cs-dest-${stamp}`);
  tmpRemote = path.join(os.tmpdir(), `repo-extract-cs-remote-${stamp}`);
  await mkdir(tmpRoot, { recursive: true });
  await mkdir(tmpDest, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  await rm(tmpDest, { recursive: true, force: true });
  await rm(tmpRemote, { recursive: true, force: true });
});

function gitInit(cwd: string): void {
  execSync("git init -b main", { cwd, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd, stdio: "pipe" });
  execSync("git config user.name Test", { cwd, stdio: "pipe" });
}

function gitCommitAll(cwd: string, msg: string): void {
  execSync("git add -A", { cwd, stdio: "pipe" });
  execSync(`git commit -m "${msg}"`, { cwd, stdio: "pipe" });
}

const baseConfig: ExtractConfig = {
  projectDir: "packages/my-pkg",
  destName: "my-pkg",
  appDirs: [],
  standalone: true,
  workspacePrefixes: ["@syrokomskyi/", "@warpgogol/"],
  stripScopes: ["@syrokomskyi/", "@warpgogol/", "@wgogol/"],
  preservePackages: [],
};

async function seedPackage(root: string, indexContent: string): Promise<void> {
  const pkgDir = path.join(root, "packages/my-pkg/src");
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    path.join(root, "packages/my-pkg/package.json"),
    JSON.stringify({ name: "@syrokomskyi/my-pkg", version: "1.0.0", type: "module" }, null, 2),
  );
  await writeFile(path.join(pkgDir, "index.ts"), indexContent);
  await writeFile(
    path.join(root, "tsconfig.base.json"),
    JSON.stringify({ compilerOptions: { target: "es2022" } }),
  );
}

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const orig = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(orig);
  }
}

describe("assertCleanSource", () => {
  it("passes on a clean repo", async () => {
    gitInit(tmpRoot);
    await seedPackage(tmpRoot, "export const v = 1;\n");
    gitCommitAll(tmpRoot, "init");
    expect(() => assertCleanSource(tmpRoot, ["packages/my-pkg"])).not.toThrow();
  });

  it("throws GitOperationError on uncommitted changes under the dir", async () => {
    gitInit(tmpRoot);
    await seedPackage(tmpRoot, "export const v = 1;\n");
    gitCommitAll(tmpRoot, "init");
    await writeFile(path.join(tmpRoot, "packages/my-pkg/src/index.ts"), "dirty\n");
    expect(() => assertCleanSource(tmpRoot, ["packages/my-pkg"])).toThrow(GitOperationError);
    expect(() => assertCleanSource(tmpRoot, ["packages/my-pkg"])).toThrow(/allow-dirty/);
  });

  it("throws on untracked files under the dir", async () => {
    gitInit(tmpRoot);
    await seedPackage(tmpRoot, "export const v = 1;\n");
    gitCommitAll(tmpRoot, "init");
    await writeFile(path.join(tmpRoot, "packages/my-pkg/untracked.txt"), "x\n");
    expect(() => assertCleanSource(tmpRoot, ["packages/my-pkg"])).toThrow(GitOperationError);
  });

  it("ignores dirt outside the exported dirs", async () => {
    gitInit(tmpRoot);
    await seedPackage(tmpRoot, "export const v = 1;\n");
    gitCommitAll(tmpRoot, "init");
    await mkdir(path.join(tmpRoot, "apps/other"), { recursive: true });
    await writeFile(path.join(tmpRoot, "apps/other/wip.ts"), "wip\n");
    expect(() => assertCleanSource(tmpRoot, ["packages/my-pkg"])).not.toThrow();
  });

  it("skips when root is not a git repository", () => {
    expect(() => assertCleanSource(tmpRoot, ["packages/my-pkg"])).not.toThrow();
  });
});

describe("materializeHeadWorktree", () => {
  it("materializes HEAD content and cleans up", async () => {
    gitInit(tmpRoot);
    await seedPackage(tmpRoot, "export const v = 1;\n");
    gitCommitAll(tmpRoot, "init");
    await writeFile(path.join(tmpRoot, "packages/my-pkg/src/index.ts"), "dirty\n");

    const wt = await materializeHeadWorktree(tmpRoot, "HEAD");
    expect(existsSync(wt.dir)).toBe(true);
    const content = await readFile(path.join(wt.dir, "packages/my-pkg/src/index.ts"), "utf-8");
    expect(content).toBe("export const v = 1;\n");

    await wt.cleanup();
    expect(existsSync(wt.dir)).toBe(false);
    const listed = execSync("git worktree list --porcelain", {
      cwd: tmpRoot,
      encoding: "utf-8",
    });
    expect(listed).not.toContain(wt.dir);
  });

  it("throws GitOperationError for an unresolvable ref", async () => {
    gitInit(tmpRoot);
    await seedPackage(tmpRoot, "export const v = 1;\n");
    gitCommitAll(tmpRoot, "init");
    await expect(materializeHeadWorktree(tmpRoot, "refs/heads/nope")).rejects.toThrow(
      GitOperationError,
    );
  });
});

describe("extractProject clean-source modes", () => {
  it("rejects export on a dirty source tree by default", async () => {
    gitInit(tmpRoot);
    await seedPackage(tmpRoot, "export const v = 1;\n");
    gitCommitAll(tmpRoot, "init");
    await writeFile(path.join(tmpRoot, "packages/my-pkg/src/index.ts"), "dirty\n");

    await expect(
      withCwd(tmpRoot, () => extractProject(baseConfig, { dest: tmpDest })),
    ).rejects.toThrow(GitOperationError);
  });

  it("exports dirty content when allowDirty is set", async () => {
    gitInit(tmpRoot);
    await seedPackage(tmpRoot, "export const v = 1;\n");
    gitCommitAll(tmpRoot, "init");
    await writeFile(path.join(tmpRoot, "packages/my-pkg/src/index.ts"), "dirty\n");

    const result = await withCwd(tmpRoot, () =>
      extractProject(baseConfig, { dest: tmpDest, allowDirty: true }),
    );
    expect(result.filesCopied).toBeGreaterThan(0);
    const content = await readFile(path.join(tmpDest, "src/index.ts"), "utf-8");
    expect(content).toBe("dirty\n");
  });

  it("exports HEAD content under fromHead, excluding working-tree changes", async () => {
    gitInit(tmpRoot);
    await seedPackage(tmpRoot, "export const v = 1;\n");
    gitCommitAll(tmpRoot, "init");
    await writeFile(path.join(tmpRoot, "packages/my-pkg/src/index.ts"), "dirty\n");
    await writeFile(path.join(tmpRoot, "packages/my-pkg/untracked.txt"), "x\n");

    const result = await withCwd(tmpRoot, () =>
      extractProject(baseConfig, { dest: tmpDest, fromHead: true }),
    );
    expect(result.filesCopied).toBeGreaterThan(0);
    const content = await readFile(path.join(tmpDest, "src/index.ts"), "utf-8");
    expect(content).toBe("export const v = 1;\n");
    expect(existsSync(path.join(tmpDest, "untracked.txt"))).toBe(false);
  });

  it("rejects versionBump combined with fromHead", async () => {
    gitInit(tmpRoot);
    await seedPackage(tmpRoot, "export const v = 1;\n");
    gitCommitAll(tmpRoot, "init");

    await expect(
      withCwd(tmpRoot, () =>
        extractProject({ ...baseConfig, versionBump: "minor" }, { dest: tmpDest, fromHead: true }),
      ),
    ).rejects.toThrow(/versionBump/);
  });

  it("rejects allowDirty combined with fromHead", async () => {
    gitInit(tmpRoot);
    await seedPackage(tmpRoot, "export const v = 1;\n");
    gitCommitAll(tmpRoot, "init");

    await expect(
      withCwd(tmpRoot, () =>
        extractProject(baseConfig, { dest: tmpDest, fromHead: true, allowDirty: true }),
      ),
    ).rejects.toThrow(GitOperationError);
  });
});

describe("commitExport push reconciliation", () => {
  async function seedRemote(): Promise<void> {
    await mkdir(tmpRemote, { recursive: true });
    execSync("git init --bare -b main", { cwd: tmpRemote, stdio: "pipe" });
  }

  it("reconciles a non-fast-forward rejection via merge -s ours", async () => {
    await seedRemote();
    gitInit(tmpDest);
    await writeFile(path.join(tmpDest, "a.txt"), "export-a\n");
    const first = await commitExport(tmpDest, "export 1", {
      remote: tmpRemote,
      autoPush: true,
      autoReconcile: true,
    });
    expect(first.pushed).toBe(true);

    // Diverge the remote: push a commit from an independent clone.
    const other = path.join(os.tmpdir(), `repo-extract-cs-other-${Date.now()}`);
    execSync(`git clone ${tmpRemote} ${other}`, { stdio: "pipe" });
    gitInit(other);
    execSync("git checkout main", { cwd: other, stdio: "pipe" });
    await writeFile(path.join(other, "remote-only.txt"), "remote\n");
    gitCommitAll(other, "remote diverge");
    execSync("git push", { cwd: other, stdio: "pipe" });

    await writeFile(path.join(tmpDest, "a.txt"), "export-b\n");
    const result = await commitExport(tmpDest, "export 2", {
      remote: tmpRemote,
      autoPush: true,
      autoReconcile: true,
    });
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);

    // Local tree stays authoritative: remote-only.txt must not appear in dest.
    expect(existsSync(path.join(tmpDest, "remote-only.txt"))).toBe(false);
    const head = execSync("git rev-parse HEAD", { cwd: tmpDest, encoding: "utf-8" }).trim();
    const remoteHead = execSync("git rev-parse main", {
      cwd: tmpRemote,
      encoding: "utf-8",
    }).trim();
    expect(remoteHead).toBe(head);
    await rm(other, { recursive: true, force: true });
  });

  it("fails closed on the same divergence without autoReconcile", async () => {
    await seedRemote();
    gitInit(tmpDest);
    await writeFile(path.join(tmpDest, "a.txt"), "export-a\n");
    const first = await commitExport(tmpDest, "export 1", {
      remote: tmpRemote,
      autoPush: true,
    });
    expect(first.pushed).toBe(true);

    const other = path.join(os.tmpdir(), `repo-extract-cs-other-${Date.now()}`);
    execSync(`git clone ${tmpRemote} ${other}`, { stdio: "pipe" });
    gitInit(other);
    execSync("git checkout main", { cwd: other, stdio: "pipe" });
    await writeFile(path.join(other, "remote-only.txt"), "remote\n");
    gitCommitAll(other, "remote diverge");
    execSync("git push", { cwd: other, stdio: "pipe" });

    await writeFile(path.join(tmpDest, "a.txt"), "export-b\n");
    const logger = { log: () => {}, error: () => {} };
    const result = await commitExport(
      tmpDest,
      "export 2",
      { remote: tmpRemote, autoPush: true },
      logger,
    );
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    await rm(other, { recursive: true, force: true });
  });
});
