import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { extractProject } from "../src/extract.js";
import { SecretScanError } from "../src/errors.js";
import { diffSummary, buildGitignore, buildRootPackageJson, isIgnored } from "../src/index.js";
import type { ExtractConfig, ExtractProgressEvent } from "../src/types.js";

let tmpRoot: string;
let tmpDest: string;

beforeEach(async () => {
  tmpRoot = path.join(
    os.tmpdir(),
    `repo-extract-api-root-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  tmpDest = path.join(
    os.tmpdir(),
    `repo-extract-api-dest-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpRoot, { recursive: true });
  await mkdir(tmpDest, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  await rm(tmpDest, { recursive: true, force: true });
});

function makeStandaloneConfig(): ExtractConfig {
  return {
    projectDir: "packages/my-pkg",
    destName: "my-pkg",
    appDirs: [],
    standalone: true,
    workspacePrefixes: ["@syrokomskyi/", "@warpgogol/"],
    stripScopes: ["@syrokomskyi/", "@warpgogol/", "@wgogol/"],
    preservePackages: ["@warpgogol/repo-extract"],
  };
}

async function setupStandalonePkg() {
  const pkgDir = path.join(tmpRoot, "packages", "my-pkg");
  await mkdir(path.join(pkgDir, "src"), { recursive: true });
  await writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: "@syrokomskyi/my-pkg", version: "1.0.0", type: "module" }, null, 2),
  );
  await writeFile(
    path.join(pkgDir, "tsconfig.json"),
    JSON.stringify(
      { extends: "../../tsconfig.base.json", compilerOptions: { rootDir: "src" } },
      null,
      2,
    ),
  );
  await writeFile(path.join(pkgDir, "src", "index.ts"), "export const hello = 'world';\n");
  await writeFile(
    path.join(tmpRoot, "tsconfig.base.json"),
    JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext" } }, null, 2),
  );
}

describe("extractProject API", () => {
  it("returns ExtractResult with correct metadata", async () => {
    await setupStandalonePkg();
    const config = makeStandaloneConfig();
    const origCwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      const result = await extractProject(config, { dest: tmpDest });
      expect(result).toBeDefined();
      expect(result.dest).toBe(tmpDest);
      expect(result.mode).toBe("standalone");
      expect(result.filesCopied).toBeGreaterThan(0);
      expect(result.packagesCopied).toBe(0);
      expect(typeof result.gitCommitted).toBe("boolean");
      expect(typeof result.gitPushed).toBe("boolean");
      expect(typeof result.changelogGenerated).toBe("boolean");
      expect(typeof result.secretsScanned).toBe("boolean");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("throws SecretScanError when secrets found (not process.exit)", async () => {
    await setupStandalonePkg();
    const pkgDir = path.join(tmpRoot, "packages", "my-pkg");
    await writeFile(
      path.join(pkgDir, "src", "secret.ts"),
      'const apiKey = "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB";\n',
    );
    const config = makeStandaloneConfig();
    const origCwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await expect(extractProject(config, { dest: tmpDest })).rejects.toBeInstanceOf(
        SecretScanError,
      );
    } finally {
      process.chdir(origCwd);
    }
  });

  it("onProgress callback receives events in correct order", async () => {
    await setupStandalonePkg();
    const config = makeStandaloneConfig();
    const events: ExtractProgressEvent[] = [];
    const origCwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await extractProject(config, { dest: tmpDest, onProgress: (e) => events.push(e) });
    } finally {
      process.chdir(origCwd);
    }

    const phases = events.map((e) => e.phase);
    expect(phases[0]).toBe("start");
    expect(phases).toContain("cleaning");
    expect(phases).toContain("copying");
    expect(phases).toContain("scanning");
    expect(phases).toContain("gitHistory");
    expect(phases).toContain("gitCommit");
    expect(phases[phases.length - 1]).toBe("complete");
  });

  it("onProgress error event fired on failure", async () => {
    await setupStandalonePkg();
    const pkgDir = path.join(tmpRoot, "packages", "my-pkg");
    await writeFile(
      path.join(pkgDir, "src", "secret.ts"),
      'const apiKey = "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB";\n',
    );
    const config = makeStandaloneConfig();
    const events: ExtractProgressEvent[] = [];
    const origCwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await expect(
        extractProject(config, { dest: tmpDest, onProgress: (e) => events.push(e) }),
      ).rejects.toBeInstanceOf(SecretScanError);
    } finally {
      process.chdir(origCwd);
    }

    const errorEvents = events.filter((e) => e.phase === "error");
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].phase).toBe("error");
    if (errorEvents[0].phase === "error") {
      expect(errorEvents[0].error).toBeInstanceOf(SecretScanError);
    }
  });

  it("verbose: false suppresses extract.ts logger output", async () => {
    await setupStandalonePkg();
    const config = makeStandaloneConfig();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const origCwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await extractProject(config, { dest: tmpDest, verbose: false });
    } finally {
      process.chdir(origCwd);
    }
    const calls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes("Exporting"))).toBe(false);
    expect(calls.some((c) => c.includes("Cleaning destination"))).toBe(false);
    expect(calls.some((c) => c.includes("Copying standalone"))).toBe(false);
    logSpy.mockRestore();
  });

  it("verbose: true produces console.log output", async () => {
    await setupStandalonePkg();
    const config = makeStandaloneConfig();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const origCwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await extractProject(config, { dest: tmpDest, verbose: true });
    } finally {
      process.chdir(origCwd);
    }
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

describe("index.ts exports", () => {
  it("diffSummary is exported and returns string or null", () => {
    expect(typeof diffSummary).toBe("function");
    const result = diffSummary("/nonexistent-path");
    expect(result).toBeNull();
  });

  it("buildGitignore is exported and returns string", () => {
    expect(typeof buildGitignore).toBe("function");
    const content = buildGitignore();
    expect(typeof content).toBe("string");
    expect(content).toContain("node_modules");
  });

  it("buildRootPackageJson is exported and returns object", () => {
    expect(typeof buildRootPackageJson).toBe("function");
    const config = makeStandaloneConfig();
    const pkg = buildRootPackageJson("test-pkg", config, "pnpm");
    expect(typeof pkg).toBe("object");
  });

  it("isIgnored is exported and returns boolean", () => {
    expect(typeof isIgnored).toBe("function");
    expect(isIgnored("node_modules")).toBe(true);
    expect(isIgnored("src")).toBe(false);
  });
});
