import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  generateCiWorkflow,
  fixStandalonePackageJson,
  fixStandaloneVitestConfig,
  buildRootPackageJson,
} from "../src/fs/transform.js";
import type { ExtractConfig } from "../src/types.js";

const baseConfig: ExtractConfig = {
  projectDir: "packages/test",
  destName: "test",
  appDirs: [],
  workspacePrefixes: ["@syrokomskyi/", "@warpgogol/", "@wgogol/"],
  stripScopes: ["@syrokomskyi/", "@warpgogol/", "@wgogol/"],
  preservePackages: ["@warpgogol/repo-extract"],
  packageManager: "pnpm@10.33.0",
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
  it("generates a valid CI workflow YAML", () => {
    const yaml = generateCiWorkflow();
    expect(yaml).toContain("name: CI");
    expect(yaml).toContain("pnpm install --frozen-lockfile");
    expect(yaml).toContain("pnpm run lint");
    expect(yaml).toContain("pnpm run typecheck");
    expect(yaml).toContain("pnpm run build");
    expect(yaml).toContain("pnpm test");
    expect(yaml).toContain("actions/checkout@v5");
    expect(yaml).toContain("pnpm/action-setup@v6");
  });

  it("includes npm publish with provenance", () => {
    const yaml = generateCiWorkflow();
    expect(yaml).toContain("npm publish --provenance");
    expect(yaml).toContain("NODE_AUTH_TOKEN");
  });

  it("includes id-token: write permission for provenance", () => {
    const yaml = generateCiWorkflow();
    expect(yaml).toContain("id-token: write");
  });
});

describe("buildRootPackageJson", () => {
  it("includes a test script", () => {
    const pkg = buildRootPackageJson("my-app", baseConfig) as { scripts: Record<string, string> };
    expect(pkg.scripts.test).toBeDefined();
    expect(pkg.scripts.test).toContain("--if-present test");
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

    await fixStandalonePackageJson(tmpDir, baseConfig);

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

    await fixStandalonePackageJson(tmpDir, baseConfig);

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

    await fixStandalonePackageJson(tmpDir, baseConfig);

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

    await fixStandalonePackageJson(tmpDir, baseConfig);

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

    await fixStandalonePackageJson(tmpDir, baseConfig);

    const result = JSON.parse(await readFile(path.join(tmpDir, "package.json"), "utf-8"));
    expect(result.scripts.test).toBe("vitest run");
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

  it("extended mode includes extra debug patterns", async () => {
    const { buildGitignore } = await import("../src/fs/transform.js");
    const extendedConfig: ExtractConfig = {
      ...baseConfig,
      gitignoreMode: "extended",
    };
    const content = buildGitignore([], extendedConfig);
    expect(content).toContain(".output");
    expect(content).toContain(".debug");
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
    const pkg = buildRootPackageJson("my-app", baseConfig) as { name: string };
    expect(pkg.name).toBe("exported-my-app");
  });

  it("uses rootPackageName when set", () => {
    const namedConfig: ExtractConfig = {
      ...baseConfig,
      rootPackageName: "@acme/clients-hdri",
    };
    const pkg = buildRootPackageJson("hdri", namedConfig) as { name: string };
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
