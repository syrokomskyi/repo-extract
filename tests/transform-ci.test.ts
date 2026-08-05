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
    expect(yaml).toContain("pnpm run typecheck");
    expect(yaml).toContain("pnpm run build");
    expect(yaml).toContain("pnpm test");
    expect(yaml).toContain("actions/checkout@v5");
    expect(yaml).toContain("pnpm/action-setup@v6");
  });
});

describe("buildRootPackageJson", () => {
  it("includes a test script", () => {
    const pkg = buildRootPackageJson("my-app") as { scripts: Record<string, string> };
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

    await fixStandalonePackageJson(tmpDir);

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

    await fixStandalonePackageJson(tmpDir);

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

    await fixStandalonePackageJson(tmpDir);

    const result = JSON.parse(await readFile(path.join(tmpDir, "package.json"), "utf-8"));
    expect(result.devDependencies).toHaveProperty("@warpgogol/repo-extract");
    expect(result.devDependencies).not.toHaveProperty("@wgogol/old");
    expect(result.devDependencies).not.toHaveProperty("@warpgogol/changelog-live");
    expect(result.devDependencies).toHaveProperty("vitest");
  });

  it("does not modify already-standalone test scripts", async () => {
    const pkg = {
      name: "@warpgogol/test",
      scripts: {
        test: "vitest run",
      },
    };
    await writeFile(path.join(tmpDir, "package.json"), JSON.stringify(pkg, null, 2));

    await fixStandalonePackageJson(tmpDir);

    const result = JSON.parse(await readFile(path.join(tmpDir, "package.json"), "utf-8"));
    expect(result.scripts.test).toBe("vitest run");
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
