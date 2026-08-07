import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  generateCiWorkflow,
  fixStandalonePackageJson,
  fixStandaloneVitestConfig,
  buildRootPackageJson,
  bumpSourceVersion,
} from "../src/fs/transform.js";
import { detectPackageManager } from "../src/package-manager.js";
import { getMonorepoConfigFiles } from "../src/fs/copy.js";
import type { ExtractConfig, PackageManager } from "../src/types.js";

const baseConfig: ExtractConfig = {
  projectDir: "packages/test",
  destName: "test",
  appDirs: [],
  workspacePrefixes: ["@syrokomskyi/", "@warpgogol/", "@wgogol/"],
  stripScopes: ["@syrokomskyi/", "@warpgogol/", "@wgogol/"],
  preservePackages: ["@warpgogol/repo-extract"],
  packageManager: "pnpm",
};

async function mkdtemp(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `repo-extract-ci-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("generateCiWorkflow", () => {
  it("generates a valid CI workflow YAML for pnpm", () => {
    const yaml = generateCiWorkflow("pnpm")!;
    expect(yaml).toContain("name: CI");
    expect(yaml).toContain(
      "pnpm install --frozen-lockfile --config.dangerouslyAllowAllBuilds=true",
    );
    expect(yaml).toContain("pnpm run lint");
    expect(yaml).toContain("pnpm run typecheck");
    expect(yaml).toContain("pnpm run build");
    expect(yaml).toContain("pnpm test");
    expect(yaml).toContain("actions/checkout@v5");
    expect(yaml).toContain("pnpm/action-setup@v6");
  });

  it("generates a valid CI workflow YAML for npm", () => {
    const yaml = generateCiWorkflow("npm")!;
    expect(yaml).toContain("npm ci");
    expect(yaml).toContain("npm run lint");
    expect(yaml).toContain("npm run typecheck");
    expect(yaml).toContain("npm run build");
    expect(yaml).toContain("npm test");
    expect(yaml).not.toContain("pnpm/action-setup");
    expect(yaml).toContain("cache: npm");
  });

  it("generates a valid CI workflow YAML for yarn", () => {
    const yaml = generateCiWorkflow("yarn")!;
    expect(yaml).toContain("yarn install --frozen-lockfile");
    expect(yaml).toContain("yarn lint");
    expect(yaml).toContain("yarn typecheck");
    expect(yaml).toContain("yarn build");
    expect(yaml).toContain("yarn test");
    expect(yaml).toContain("cache: yarn");
  });

  it("includes npm publish with provenance in a separate publish job", () => {
    const yaml = generateCiWorkflow("pnpm")!;
    expect(yaml).toContain("npm publish --provenance");
    expect(yaml).toContain("NODE_AUTH_TOKEN");
    expect(yaml).toContain("  publish:");
    expect(yaml).toContain("    needs: ci");
    expect(yaml).toContain("registry-url: https://registry.npmjs.org");
  });

  it("includes id-token: write permission for provenance", () => {
    const yaml = generateCiWorkflow("pnpm")!;
    expect(yaml).toContain("id-token: write");
  });

  it("publish job only runs on push, not pull_request", () => {
    const yaml = generateCiWorkflow("pnpm")!;
    expect(yaml).toContain("if: github.event_name == 'push'");
  });

  it("returns null when provider is none", () => {
    const yaml = generateCiWorkflow("pnpm", { provider: "none", publish: false, nodeVersion: 22 });
    expect(yaml).toBeNull();
  });

  it("omits publish job when publish is false", () => {
    const yaml = generateCiWorkflow("pnpm", {
      provider: "github-actions",
      publish: false,
      nodeVersion: 22,
    })!;
    expect(yaml).not.toContain("npm publish");
    expect(yaml).not.toContain("  publish:");
  });

  it("uses custom node version", () => {
    const yaml = generateCiWorkflow("npm", {
      provider: "github-actions",
      publish: true,
      nodeVersion: 20,
    })!;
    expect(yaml).toContain("node-version: 20");
  });
});

describe("buildRootPackageJson", () => {
  it("includes a test script for pnpm", () => {
    const pkg = buildRootPackageJson("my-app", baseConfig, "pnpm") as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.test).toBeDefined();
    expect(pkg.scripts.test).toContain("--if-present test");
  });

  it("uses npm workspaces scripts for npm", () => {
    const pkg = buildRootPackageJson("my-app", baseConfig, "npm") as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.build).toContain("npm run build --workspaces");
    expect(pkg.scripts.test).toContain("npm test --workspaces");
  });

  it("uses yarn workspaces foreach for yarn", () => {
    const pkg = buildRootPackageJson("my-app", baseConfig, "yarn") as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.build).toContain("yarn workspaces foreach run build");
    expect(pkg.scripts.test).toContain("yarn workspaces foreach run test");
  });
});

describe("fixStandalonePackageJson", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("rewrites monorepo-style test script to standalone vitest run", async () => {
    const pkg = {
      name: "@warpgogol/test",
      scripts: {
        build: "tsc -p tsconfig.build.json",
        test: "pnpm --dir ../../.. exec vitest run --config packages/test/vitest.config.ts",
      },
    };
    await writeFile(path.join(tmpDir, "package.json"), JSON.stringify(pkg, null, 2));

    await fixStandalonePackageJson(tmpDir, baseConfig, "pnpm");

    const result = JSON.parse(await readFile(path.join(tmpDir, "package.json"), "utf-8"));
    expect(result.scripts.test).toBe("vitest run");
  });

  it("replaces workspace:* with * for remaining deps", async () => {
    const pkg = {
      name: "@warpgogol/test",
      dependencies: {
        zod: "workspace:*",
      },
    };
    await writeFile(path.join(tmpDir, "package.json"), JSON.stringify(pkg, null, 2));

    await fixStandalonePackageJson(tmpDir, baseConfig, "pnpm");

    const result = JSON.parse(await readFile(path.join(tmpDir, "package.json"), "utf-8"));
    expect(result.dependencies.zod).toBe("*");
  });

  it("strips @wgogol/* and @warpgogol/* deps (except repo-extract)", async () => {
    const pkg = {
      name: "@warpgogol/test",
      devDependencies: {
        "@wgogol/old": "workspace:*",
        "@warpgogol/changelog-live": "workspace:*",
        "@warpgogol/repo-extract": "workspace:*",
        vitest: "^4.0.0",
      },
    };
    await writeFile(path.join(tmpDir, "package.json"), JSON.stringify(pkg, null, 2));

    await fixStandalonePackageJson(tmpDir, baseConfig, "pnpm");

    const result = JSON.parse(await readFile(path.join(tmpDir, "package.json"), "utf-8"));
    expect(result.devDependencies).toHaveProperty("@warpgogol/repo-extract");
    expect(result.devDependencies).not.toHaveProperty("@wgogol/old");
    expect(result.devDependencies).not.toHaveProperty("@warpgogol/changelog-live");
    expect(result.devDependencies).toHaveProperty("vitest");
  });

  it("preserves @warpgogol/* in peerDependencies (only converts workspace:*)", async () => {
    const pkg = {
      name: "@warpgogol/test",
      peerDependencies: {
        "@warpgogol/changelog-live": "workspace:*",
      },
      peerDependenciesMeta: {
        "@warpgogol/changelog-live": { optional: true },
      },
      devDependencies: {
        "@warpgogol/changelog-live": "workspace:*",
      },
    };
    await writeFile(path.join(tmpDir, "package.json"), JSON.stringify(pkg, null, 2));

    await fixStandalonePackageJson(tmpDir, baseConfig, "pnpm");

    const result = JSON.parse(await readFile(path.join(tmpDir, "package.json"), "utf-8"));
    expect(result.peerDependencies).toHaveProperty("@warpgogol/changelog-live");
    expect(result.peerDependencies["@warpgogol/changelog-live"]).toBe("*");
    expect(result.peerDependenciesMeta).toBeDefined();
    expect(result.devDependencies).toBeUndefined();
  });

  it("does not modify already-standalone test scripts", async () => {
    const pkg = {
      name: "@warpgogol/test",
      scripts: {
        test: "vitest run",
      },
      packageManager: "pnpm@10.33.0",
    };
    await writeFile(path.join(tmpDir, "package.json"), JSON.stringify(pkg, null, 2));

    await fixStandalonePackageJson(tmpDir, baseConfig, "pnpm");

    const result = JSON.parse(await readFile(path.join(tmpDir, "package.json"), "utf-8"));
    expect(result.scripts.test).toBe("vitest run");
  });

  it("does not modify version when versionBump is not set", async () => {
    const pkg = { name: "@warpgogol/test", version: "1.2.0" };
    await writeFile(path.join(tmpDir, "package.json"), JSON.stringify(pkg, null, 2));

    await fixStandalonePackageJson(tmpDir, baseConfig, "pnpm");

    const result = JSON.parse(await readFile(path.join(tmpDir, "package.json"), "utf-8"));
    expect(result.version).toBe("1.2.0");
  });
});

describe("bumpSourceVersion", () => {
  it("bumps patch version in source package.json", async () => {
    const srcDir = await mkdtemp();
    const srcPkgDir = path.join(srcDir, "packages", "test-pkg");
    await mkdir(srcPkgDir, { recursive: true });
    await writeFile(
      path.join(srcPkgDir, "package.json"),
      JSON.stringify({ name: "@warpgogol/test", version: "1.2.0" }, null, 2),
    );

    await bumpSourceVersion(srcDir, {
      ...baseConfig,
      versionBump: "patch",
      projectDir: "packages/test-pkg",
    });

    const srcResult = JSON.parse(await readFile(path.join(srcPkgDir, "package.json"), "utf-8"));
    expect(srcResult.version).toBe("1.2.1");
  });

  it("bumps minor version in source package.json", async () => {
    const srcDir = await mkdtemp();
    const srcPkgDir = path.join(srcDir, "packages", "test-pkg");
    await mkdir(srcPkgDir, { recursive: true });
    await writeFile(
      path.join(srcPkgDir, "package.json"),
      JSON.stringify({ name: "@warpgogol/test", version: "1.2.3" }, null, 2),
    );

    await bumpSourceVersion(srcDir, {
      ...baseConfig,
      versionBump: "minor",
      projectDir: "packages/test-pkg",
    });

    const srcResult = JSON.parse(await readFile(path.join(srcPkgDir, "package.json"), "utf-8"));
    expect(srcResult.version).toBe("1.3.0");
  });

  it("bumps major version in source package.json", async () => {
    const srcDir = await mkdtemp();
    const srcPkgDir = path.join(srcDir, "packages", "test-pkg");
    await mkdir(srcPkgDir, { recursive: true });
    await writeFile(
      path.join(srcPkgDir, "package.json"),
      JSON.stringify({ name: "@warpgogol/test", version: "1.2.3" }, null, 2),
    );

    await bumpSourceVersion(srcDir, {
      ...baseConfig,
      versionBump: "major",
      projectDir: "packages/test-pkg",
    });

    const srcResult = JSON.parse(await readFile(path.join(srcPkgDir, "package.json"), "utf-8"));
    expect(srcResult.version).toBe("2.0.0");
  });

  it("does nothing when versionBump is not set", async () => {
    const srcDir = await mkdtemp();
    const srcPkgDir = path.join(srcDir, "packages", "test-pkg");
    await mkdir(srcPkgDir, { recursive: true });
    await writeFile(
      path.join(srcPkgDir, "package.json"),
      JSON.stringify({ name: "@warpgogol/test", version: "1.2.0" }, null, 2),
    );

    await bumpSourceVersion(srcDir, { ...baseConfig, projectDir: "packages/test-pkg" });

    const srcResult = JSON.parse(await readFile(path.join(srcPkgDir, "package.json"), "utf-8"));
    expect(srcResult.version).toBe("1.2.0");
  });
});

describe("buildGitignore", () => {
  it("minimal mode excludes org-specific patterns", async () => {
    const { buildGitignore } = await import("../src/fs/transform.js");
    const minimalConfig: ExtractConfig = {
      ...baseConfig,
      gitignoreMode: "minimal",
    };
    const content = buildGitignore([], minimalConfig);
    expect(content).not.toContain(".cadence-state.json");
    expect(content).not.toContain(".pipeline-data/");
    expect(content).not.toContain("archive/");
    expect(content).toContain("node_modules");
    expect(content).toContain("dist");
  });

  it("extended mode includes extraGitignore lines", async () => {
    const { buildGitignore } = await import("../src/fs/transform.js");
    const extendedConfig: ExtractConfig = {
      ...baseConfig,
      gitignoreMode: "extended",
    };
    const content = buildGitignore([".output", ".debug", ".debug-public"], extendedConfig);
    expect(content).toContain(".output");
    expect(content).toContain(".debug");
    expect(content).toContain(".debug-public");
  });

  it("extended mode without extraGitignore has only org-neutral patterns", async () => {
    const { buildGitignore } = await import("../src/fs/transform.js");
    const extendedConfig: ExtractConfig = {
      ...baseConfig,
      gitignoreMode: "extended",
    };
    const content = buildGitignore([], extendedConfig);
    expect(content).toContain("node_modules");
    expect(content).toContain("dist");
    expect(content).not.toContain(".output");
    expect(content).not.toContain(".debug");
  });
});

describe("regenerateTsconfigBase", () => {
  it("omits customConditions when empty", async () => {
    const { regenerateTsconfigBase } = await import("../src/fs/transform.js");
    const tmpDir = await mkdtemp();
    const emptyConfig: ExtractConfig = {
      ...baseConfig,
      customConditions: [],
    };
    await regenerateTsconfigBase(tmpDir, emptyConfig);

    const result = JSON.parse(await readFile(path.join(tmpDir, "tsconfig.base.json"), "utf-8"));
    expect(result.compilerOptions.customConditions).toBeUndefined();

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("includes customConditions when non-empty", async () => {
    const { regenerateTsconfigBase } = await import("../src/fs/transform.js");
    const tmpDir = await mkdtemp();
    const ccConfig: ExtractConfig = {
      ...baseConfig,
      customConditions: ["@acme/source"],
    };
    await regenerateTsconfigBase(tmpDir, ccConfig);

    const result = JSON.parse(await readFile(path.join(tmpDir, "tsconfig.base.json"), "utf-8"));
    expect(result.compilerOptions.customConditions).toEqual(["@acme/source"]);

    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe("buildRootPackageJson default name", () => {
  it("uses exported-{destName} when rootPackageName not set", () => {
    const pkg = buildRootPackageJson("my-app", baseConfig, "pnpm") as { name: string };
    expect(pkg.name).toBe("exported-my-app");
  });

  it("uses rootPackageName when set", () => {
    const namedConfig: ExtractConfig = {
      ...baseConfig,
      rootPackageName: "@acme/clients-hdri",
    };
    const pkg = buildRootPackageJson("hdri", namedConfig, "pnpm") as { name: string };
    expect(pkg.name).toBe("@acme/clients-hdri");
  });
});

describe("fixStandaloneVitestConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("rewrites monorepo-relative test paths to standalone", async () => {
    const config = `import { defineConfig } from "vitest/config";\nexport default defineConfig({\n  test: { include: ["packages/repo-extract/tests/**/*.test.ts"] },\n});\n`;
    await writeFile(path.join(tmpDir, "vitest.config.ts"), config);

    await fixStandaloneVitestConfig(tmpDir);

    const result = await readFile(path.join(tmpDir, "vitest.config.ts"), "utf-8");
    expect(result).toContain('"tests/**/*.test.ts"');
    expect(result).not.toContain("packages/repo-extract");
  });

  it("does not modify already-standalone configs", async () => {
    const config = `import { defineConfig } from "vitest/config";\nexport default defineConfig({\n  test: { include: ["tests/**/*.test.ts"] },\n});\n`;
    await writeFile(path.join(tmpDir, "vitest.config.ts"), config);

    await fixStandaloneVitestConfig(tmpDir);

    const result = await readFile(path.join(tmpDir, "vitest.config.ts"), "utf-8");
    expect(result).toContain('"tests/**/*.test.ts"');
  });
});

describe("detectPackageManager", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("detects pnpm from pnpm-lock.yaml", () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(tmpDir)).toBe("pnpm");
  });

  it("detects yarn from yarn.lock", () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(path.join(tmpDir, "yarn.lock"), "");
    expect(detectPackageManager(tmpDir)).toBe("yarn");
  });

  it("detects npm from package-lock.json", () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(path.join(tmpDir, "package-lock.json"), "{}");
    expect(detectPackageManager(tmpDir)).toBe("npm");
  });

  it("defaults to pnpm when no lockfile found", () => {
    expect(detectPackageManager(tmpDir)).toBe("pnpm");
  });
});

describe("getMonorepoConfigFiles", () => {
  it("includes pnpm-workspace.yaml for pnpm", () => {
    const files = getMonorepoConfigFiles("pnpm");
    expect(files).toContain("pnpm-workspace.yaml");
  });

  it("excludes pnpm-workspace.yaml for npm", () => {
    const files = getMonorepoConfigFiles("npm");
    expect(files).not.toContain("pnpm-workspace.yaml");
  });

  it("excludes pnpm-workspace.yaml for yarn", () => {
    const files = getMonorepoConfigFiles("yarn");
    expect(files).not.toContain("pnpm-workspace.yaml");
  });
});
