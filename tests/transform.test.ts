import { describe, it, expect } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { transformPackageJson } from "../src/fs/transform.js";
import type { ExtractConfig } from "../src/types.js";

const baseConfig: ExtractConfig = {
  projectDir: "packages/test",
  destName: "test",
  appDirs: [],
  workspacePrefixes: ["@syrokomskyi/", "@warpgogol/", "@wgogol/"],
  stripScopes: ["@syrokomskyi/", "@warpgogol/", "@wgogol/"],
  preservePackages: ["@warpgogol/repo-extract"],
};

async function mkdtemp(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `repo-extract-transform-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("transformPackageJson", () => {
  it("strips @wgogol/* workspace dependencies", async () => {
    const tmpDir = await mkdtemp();
    const relPath = "packages/test/package.json";
    await mkdir(path.join(tmpDir, "packages/test"), { recursive: true });
    const pkg = {
      name: "@syrokomskyi/test",
      devDependencies: {
        "@wgogol/changelog-live": "workspace:*",
        zod: "^4.4.3",
      },
    };
    await writeFile(path.join(tmpDir, relPath), JSON.stringify(pkg, null, 2));

    await transformPackageJson(tmpDir, relPath, baseConfig);

    const { readFile } = await import("node:fs/promises");
    const result = JSON.parse(await readFile(path.join(tmpDir, relPath), "utf-8"));
    expect(result.devDependencies).toEqual({ zod: "^4.4.3" });

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("strips @warpgogol/* workspace dependencies (except repo-extract)", async () => {
    const tmpDir = await mkdtemp();
    const relPath = "packages/test/package.json";
    await mkdir(path.join(tmpDir, "packages/test"), { recursive: true });
    const pkg = {
      name: "@syrokomskyi/test",
      devDependencies: {
        "@warpgogol/changelog-live": "workspace:*",
        "@warpgogol/repo-extract": "workspace:*",
        zod: "^4.4.3",
      },
    };
    await writeFile(path.join(tmpDir, relPath), JSON.stringify(pkg, null, 2));

    await transformPackageJson(tmpDir, relPath, baseConfig);

    const { readFile } = await import("node:fs/promises");
    const result = JSON.parse(await readFile(path.join(tmpDir, relPath), "utf-8"));
    expect(result.devDependencies).toEqual({
      "@warpgogol/repo-extract": "workspace:*",
      zod: "^4.4.3",
    });

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("strips @syrokomskyi/compass-* dependencies", async () => {
    const tmpDir = await mkdtemp();
    const relPath = "apps/test/package.json";
    await mkdir(path.join(tmpDir, "apps/test"), { recursive: true });
    const pkg = {
      name: "@syrokomskyi/test-app",
      devDependencies: {
        "@syrokomskyi/compass-foo": "workspace:*",
        zod: "^4.4.3",
      },
    };
    await writeFile(path.join(tmpDir, relPath), JSON.stringify(pkg, null, 2));

    await transformPackageJson(tmpDir, relPath, baseConfig);

    const { readFile } = await import("node:fs/promises");
    const result = JSON.parse(await readFile(path.join(tmpDir, relPath), "utf-8"));
    expect(result.devDependencies).toEqual({ zod: "^4.4.3" });

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("renames tsconfig.lib.json to tsconfig.build.json in scripts", async () => {
    const tmpDir = await mkdtemp();
    const relPath = "packages/test/package.json";
    await mkdir(path.join(tmpDir, "packages/test"), { recursive: true });
    const pkg = {
      name: "@syrokomskyi/test",
      scripts: {
        build: "tsc -p tsconfig.lib.json",
        typecheck: "tsc -p tsconfig.lib.json --noEmit",
      },
    };
    await writeFile(path.join(tmpDir, relPath), JSON.stringify(pkg, null, 2));

    await transformPackageJson(tmpDir, relPath, baseConfig);

    const { readFile } = await import("node:fs/promises");
    const result = JSON.parse(await readFile(path.join(tmpDir, relPath), "utf-8"));
    expect(result.scripts.build).toBe("tsc -p tsconfig.build.json");
    expect(result.scripts.typecheck).toBe("tsc -p tsconfig.build.json --noEmit");

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("strips @acme/ scope when configured", async () => {
    const tmpDir = await mkdtemp();
    const relPath = "packages/test/package.json";
    await mkdir(path.join(tmpDir, "packages/test"), { recursive: true });
    const pkg = {
      name: "@acme/test",
      devDependencies: {
        "@acme/old-lib": "workspace:*",
        zod: "^4.4.3",
      },
    };
    await writeFile(path.join(tmpDir, relPath), JSON.stringify(pkg, null, 2));

    const acmeConfig: ExtractConfig = {
      ...baseConfig,
      workspacePrefixes: ["@acme/"],
      stripScopes: ["@acme/"],
      preservePackages: [],
    };
    await transformPackageJson(tmpDir, relPath, acmeConfig);

    const { readFile } = await import("node:fs/promises");
    const result = JSON.parse(await readFile(path.join(tmpDir, relPath), "utf-8"));
    expect(result.devDependencies).toEqual({ zod: "^4.4.3" });

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("does not strip any deps when stripScopes is empty", async () => {
    const tmpDir = await mkdtemp();
    const relPath = "packages/test/package.json";
    await mkdir(path.join(tmpDir, "packages/test"), { recursive: true });
    const pkg = {
      name: "@acme/test",
      devDependencies: {
        "@acme/old-lib": "workspace:*",
        zod: "^4.4.3",
      },
    };
    await writeFile(path.join(tmpDir, relPath), JSON.stringify(pkg, null, 2));

    const emptyConfig: ExtractConfig = {
      ...baseConfig,
      workspacePrefixes: [],
      stripScopes: [],
      preservePackages: [],
    };
    await transformPackageJson(tmpDir, relPath, emptyConfig);

    const { readFile } = await import("node:fs/promises");
    const result = JSON.parse(await readFile(path.join(tmpDir, relPath), "utf-8"));
    expect(result.devDependencies).toHaveProperty("@acme/old-lib");
    expect(result.devDependencies).toHaveProperty("zod");

    await rm(tmpDir, { recursive: true, force: true });
  });
});
