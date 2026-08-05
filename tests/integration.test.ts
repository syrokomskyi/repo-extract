import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { extractProject } from "../src/extract.js";
import type { ExtractConfig } from "../src/types.js";

let tmpRoot: string;
let tmpDest: string;

beforeEach(async () => {
  tmpRoot = path.join(
    os.tmpdir(),
    `repo-extract-root-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  tmpDest = path.join(
    os.tmpdir(),
    `repo-extract-dest-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpRoot, { recursive: true });
  await mkdir(tmpDest, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  await rm(tmpDest, { recursive: true, force: true });
});

describe("extractProject integration", () => {
  it("exports a standalone package to a tmpdir", async () => {
    const pkgDir = path.join(tmpRoot, "packages", "my-pkg");
    await mkdir(path.join(pkgDir, "src"), { recursive: true });
    await mkdir(path.join(pkgDir, "dist"), { recursive: true });

    await writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify(
        {
          name: "@syrokomskyi/my-pkg",
          version: "1.0.0",
          type: "module",
          main: "dist/index.js",
        },
        null,
        2,
      ),
    );

    await writeFile(
      path.join(pkgDir, "tsconfig.json"),
      JSON.stringify(
        {
          extends: "../../tsconfig.base.json",
          compilerOptions: { rootDir: "src", outDir: "dist" },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
    );

    await writeFile(path.join(pkgDir, "src", "index.ts"), "export const hello = 'world';\n");
    await writeFile(path.join(pkgDir, "dist", "index.js"), "export const hello = 'world';\n");
    await writeFile(path.join(pkgDir, "README.md"), "# my-pkg\n");

    await writeFile(
      path.join(tmpRoot, "tsconfig.base.json"),
      JSON.stringify(
        {
          compilerOptions: { target: "es2022", module: "nodenext" },
        },
        null,
        2,
      ),
    );

    const config: ExtractConfig = {
      projectDir: "packages/my-pkg",
      destName: "my-pkg",
      appDirs: [],
      standalone: true,
    };

    const origCwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await extractProject(config, { dest: tmpDest });
    } finally {
      process.chdir(origCwd);
    }

    const pkgJson = JSON.parse(await readFile(path.join(tmpDest, "package.json"), "utf-8"));
    expect(pkgJson.name).toBe("@syrokomskyi/my-pkg");

    const tsconfig = JSON.parse(await readFile(path.join(tmpDest, "tsconfig.json"), "utf-8"));
    expect(tsconfig.extends).toBeUndefined();
    expect(tsconfig.compilerOptions.target).toBeDefined();

    const readme = await readFile(path.join(tmpDest, "README.md"), "utf-8");
    expect(readme).toBe("# my-pkg\n");
  });

  it("dry-run does not write files", async () => {
    const config: ExtractConfig = {
      projectDir: "packages/my-pkg",
      destName: "my-pkg",
      appDirs: [],
      standalone: true,
    };

    const origCwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await extractProject(config, { dest: tmpDest, dryRun: true });
    } finally {
      process.chdir(origCwd);
    }

    await expect(readFile(path.join(tmpDest, "package.json"), "utf-8")).rejects.toThrow();
  });
});
