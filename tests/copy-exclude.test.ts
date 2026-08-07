import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readdir } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  copyStandalonePackage,
  copyFiltered,
  isKeyMaterial,
  isDbFile,
} from "../src/fs/copy.js";

let tmpRoot: string;
let tmpDest: string;

beforeEach(async () => {
  tmpRoot = path.join(
    os.tmpdir(),
    `repo-extract-excl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  tmpDest = path.join(tmpRoot, "dest");
  await mkdir(tmpRoot, { recursive: true });
  await mkdir(tmpDest, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("isKeyMaterial", () => {
  it("excludes .input/signing-key by default", () => {
    expect(isKeyMaterial("foo/.input/signing-key/bar.pem")).toBe(true);
    expect(isKeyMaterial("foo/other/bar.ts")).toBe(false);
  });

  it("uses custom excludePathSegments when provided", () => {
    expect(isKeyMaterial("foo/secrets/key.pem", ["secrets"])).toBe(true);
    expect(isKeyMaterial("foo/.input/signing-key/bar.pem", [])).toBe(false);
  });
});

describe("isDbFile", () => {
  it("excludes .db files by default", () => {
    expect(isDbFile("data.db")).toBe(true);
    expect(isDbFile("data.ts")).toBe(false);
  });

  it("uses custom excludeExtensions when provided", () => {
    expect(isDbFile("data.sqlite", [".sqlite"])).toBe(true);
    expect(isDbFile("data.db", [])).toBe(false);
  });
});

describe("copyStandalonePackage with ignoreDirs", () => {
  it("skips directories in ignoreDirs", async () => {
    const pkgDir = "my-pkg";
    const srcDir = path.join(tmpRoot, pkgDir);
    await mkdir(path.join(srcDir, "src"), { recursive: true });
    await mkdir(path.join(srcDir, "secrets"), { recursive: true });
    await writeFile(path.join(srcDir, "src", "index.ts"), "export {};\n");
    await writeFile(path.join(srcDir, "secrets", "key.pem"), "secret\n");

    const count = await copyStandalonePackage(tmpRoot, tmpDest, pkgDir, ["secrets"]);
    expect(count).toBe(1);

    const destEntries = await readdir(path.join(tmpDest, "src"));
    expect(destEntries).toContain("index.ts");

    await expect(readdir(path.join(tmpDest, "secrets"))).rejects.toThrow();
  });

  it("skips files matching excludePathSegments and excludeExtensions", async () => {
    const pkgDir = "my-pkg";
    const srcDir = path.join(tmpRoot, pkgDir);
    await mkdir(path.join(srcDir, "src"), { recursive: true });
    await mkdir(path.join(srcDir, ".input", "signing-key"), { recursive: true });
    await writeFile(path.join(srcDir, "src", "index.ts"), "export {};\n");
    await writeFile(path.join(srcDir, "src", "data.db"), "sqlite\n");
    await writeFile(path.join(srcDir, ".input", "signing-key", "key.pem"), "key\n");

    const count = await copyStandalonePackage(
      tmpRoot,
      tmpDest,
      pkgDir,
      undefined,
      undefined,
      undefined,
    );
    expect(count).toBe(1);

    const destEntries = await readdir(path.join(tmpDest, "src"));
    expect(destEntries).toContain("index.ts");
    expect(destEntries).not.toContain("data.db");
  });
});

describe("copyFiltered with excludePathSegments and excludeExtensions", () => {
  it("excludes files matching custom excludePathSegments", async () => {
    const subDir = "apps/myapp";
    const srcDir = path.join(tmpRoot, subDir, "secrets");
    await mkdir(srcDir, { recursive: true });
    await writeFile(path.join(srcDir, "key.pem"), "secret\n");
    await mkdir(path.join(tmpRoot, subDir, "src"), { recursive: true });
    await writeFile(path.join(tmpRoot, subDir, "src", "index.ts"), "export {};\n");

    const count = await copyFiltered(
      tmpRoot,
      tmpDest,
      subDir,
      undefined,
      ["secrets"],
    );
    expect(count).toBe(1);

    await expect(readdir(path.join(tmpDest, subDir, "secrets"))).rejects.toThrow();
  });

  it("excludes files matching custom excludeExtensions", async () => {
    const subDir = "apps/myapp";
    const srcDir = path.join(tmpRoot, subDir, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(path.join(srcDir, "index.ts"), "export {};\n");
    await writeFile(path.join(srcDir, "data.sqlite"), "sqlite\n");

    const count = await copyFiltered(
      tmpRoot,
      tmpDest,
      subDir,
      undefined,
      undefined,
      [".sqlite"],
    );
    expect(count).toBe(1);

    const destEntries = await readdir(path.join(tmpDest, subDir, "src"));
    expect(destEntries).toContain("index.ts");
    expect(destEntries).not.toContain("data.sqlite");
  });
});
