import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { runPostProcess } from "../src/postprocess/index.js";
import type { ExtractContext, PostProcessRule } from "../src/types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function mkdtemp(): Promise<string> {
  const dir = path.join(os.tmpdir(), `repo-extract-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("runPostProcess", () => {
  it("copies a file", async () => {
    const srcDir = path.join(tmpDir, "src");
    const destDir = path.join(tmpDir, "dest");
    await mkdir(srcDir, { recursive: true });
    await mkdir(destDir, { recursive: true });
    await writeFile(path.join(srcDir, "codebook.yaml"), "version: 1.0.0\n");

    const ctx: ExtractContext = {
      root: tmpDir,
      dest: destDir,
      config: { projectDir: "src", destName: "test", appDirs: [] },
      packageDirs: [],
    };

    const rules: PostProcessRule[] = [
      { action: "copy", from: "src/codebook.yaml", to: "data/codebook.yaml" },
    ];

    await runPostProcess(ctx, rules);

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(path.join(destDir, "data/codebook.yaml"), "utf-8");
    expect(content).toBe("version: 1.0.0\n");
  });

  it("patches a file with find/replace", async () => {
    const destDir = path.join(tmpDir, "dest");
    await mkdir(destDir, { recursive: true });
    const filePath = path.join(destDir, "data.ts");
    await writeFile(filePath, 'const glob = "codebook-observatory-*.yaml";');

    const ctx: ExtractContext = {
      root: tmpDir,
      dest: destDir,
      config: { projectDir: "test", destName: "test", appDirs: [] },
      packageDirs: [],
    };

    const rules: PostProcessRule[] = [
      { action: "patch", file: "data.ts", find: "codebook-observatory-*.yaml", replace: "codebook.yaml" },
    ];

    await runPostProcess(ctx, rules);

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe('const glob = "codebook.yaml";');
  });

  it("patches a file with removeLinesMatching", async () => {
    const destDir = path.join(tmpDir, "dest");
    await mkdir(destDir, { recursive: true });
    const filePath = path.join(destDir, ".gitignore");
    await writeFile(filePath, "node_modules\ncodebook-observatory\ndist\n");

    const ctx: ExtractContext = {
      root: tmpDir,
      dest: destDir,
      config: { projectDir: "test", destName: "test", appDirs: [] },
      packageDirs: [],
    };

    const rules: PostProcessRule[] = [
      { action: "patch", file: ".gitignore", removeLinesMatching: "codebook" },
    ];

    await runPostProcess(ctx, rules);

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("node_modules\ndist\n");
  });

  it("deletes a file", async () => {
    const destDir = path.join(tmpDir, "dest");
    await mkdir(destDir, { recursive: true });
    const filePath = path.join(destDir, "old-file.txt");
    await writeFile(filePath, "to be deleted");

    const ctx: ExtractContext = {
      root: tmpDir,
      dest: destDir,
      config: { projectDir: "test", destName: "test", appDirs: [] },
      packageDirs: [],
    };

    const rules: PostProcessRule[] = [
      { action: "delete", path: "old-file.txt" },
    ];

    await runPostProcess(ctx, rules);

    const { stat } = await import("node:fs/promises");
    await expect(stat(filePath)).rejects.toThrow();
  });

  it("skips patch on non-existent file", async () => {
    const destDir = path.join(tmpDir, "dest");
    await mkdir(destDir, { recursive: true });

    const ctx: ExtractContext = {
      root: tmpDir,
      dest: destDir,
      config: { projectDir: "test", destName: "test", appDirs: [] },
      packageDirs: [],
    };

    const rules: PostProcessRule[] = [
      { action: "patch", file: "nonexistent.ts", find: "old", replace: "new" },
    ];

    await runPostProcess(ctx, rules);
  });
});
