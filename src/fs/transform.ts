/*
<MODULE_CONTRACT>
<purpose>Package.json and tsconfig transformation utilities for exported repos.</purpose>
<non-goals>
  <item>Does not copy files (see copy.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Ported transformPackageJson, fixPackageTsconfigs, fixAppTsconfigs, regenerateTsconfigBase, generateRootFiles from scripts/export-clients-helpers.ts for RFC-0070.</item>
  <item>ADR-0010: added lint step, npm publish --provenance, and id-token: write to generateCiWorkflow()</item>
  <item>RFC-0071: Replaced hardcoded org-specific values with config-driven options (stripScopes, preservePackages, rootPackageName, customConditions, onlyBuiltDependencies, packageManager, gitignoreMode).</item>
</CHANGE_SUMMARY>
*/

import { readFile, writeFile, rm, access, readdir } from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import type { ExtractConfig } from "../types.js";
import { isIgnored } from "./copy.js";

export async function transformPackageJson(
  dest: string,
  relPath: string,
  config: ExtractConfig,
): Promise<void> {
  const fullPath = path.join(dest, relPath);
  let raw: string;
  try {
    raw = await readFile(fullPath, "utf-8");
  } catch {
    return;
  }

  const pkg = JSON.parse(raw);
  let changed = false;

  const stripScopes = config.stripScopes ?? config.workspacePrefixes ?? [];
  const preservePackages = config.preservePackages ?? [];

  if (pkg.devDependencies) {
    for (const key of Object.keys(pkg.devDependencies)) {
      const shouldStrip = stripScopes.some((scope) => key.startsWith(scope));
      const shouldPreserve = preservePackages.includes(key);
      if (shouldStrip && !shouldPreserve) {
        delete pkg.devDependencies[key];
        changed = true;
      }
    }
    if (Object.keys(pkg.devDependencies).length === 0) {
      delete pkg.devDependencies;
    }
  }

  if (relPath.startsWith("packages/") && pkg.scripts) {
    for (const key of ["build", "typecheck"]) {
      const script = pkg.scripts[key];
      if (typeof script === "string" && script.includes("tsconfig.lib.json")) {
        pkg.scripts[key] = script.replaceAll("tsconfig.lib.json", "tsconfig.build.json");
        changed = true;
      }
    }
  }

  if (relPath.includes("dashboard") && pkg.scripts) {
    if (pkg.scripts.build && pkg.scripts.build.includes("export:data")) {
      pkg.scripts.build = "astro build";
      changed = true;
    }
    if (pkg.scripts.dev && pkg.scripts.dev.includes("export:data")) {
      pkg.scripts.dev = "astro dev";
      changed = true;
    }
    for (const key of ["changelog", "changelog:init"]) {
      if (pkg.scripts[key]) {
        delete pkg.scripts[key];
        changed = true;
      }
    }
  }

  for (const depField of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (pkg[depField]) {
      for (const key of Object.keys(pkg[depField])) {
        const shouldStrip = stripScopes.some((scope) => key.startsWith(scope));
        const shouldPreserve = preservePackages.includes(key);
        if (shouldStrip && !shouldPreserve) {
          delete pkg[depField][key];
          changed = true;
        }
      }
      if (Object.keys(pkg[depField]).length === 0) {
        delete pkg[depField];
      }
    }
  }

  if (changed) {
    await writeFile(fullPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    console.log(`  transformed: ${relPath}`);
  }
}

export async function fixPackageTsconfigs(dest: string, packageDirs: string[]): Promise<void> {
  for (const pkgDir of packageDirs) {
    const pkgDest = path.join(dest, pkgDir);
    try {
      await rm(path.join(pkgDest, "tsconfig.lib.json"), { force: true });
    } catch {
      /* no-op */
    }
    try {
      await rm(path.join(pkgDest, "tsconfig.tsbuildinfo"), { force: true });
    } catch {
      /* no-op */
    }

    const depth = pkgDir.split("/").length;
    const baseRef = `${"../".repeat(depth)}tsconfig.base.json`;
    const tsconfigPath = path.join(pkgDest, "tsconfig.json");
    try {
      await writeFile(
        tsconfigPath,
        JSON.stringify(
          {
            extends: baseRef,
            compilerOptions: {
              rootDir: "src",
              outDir: "dist",
              tsBuildInfoFile: "dist/tsconfig.tsbuildinfo",
              emitDeclarationOnly: false,
              forceConsistentCasingInFileNames: true,
              types: ["node"],
            },
            include: ["src/**/*.ts"],
          },
          null,
          2,
        ) + "\n",
      );
    } catch {
      /* no-op */
    }

    const tsconfigBuildPath = path.join(pkgDest, "tsconfig.build.json");
    try {
      await writeFile(
        tsconfigBuildPath,
        JSON.stringify(
          {
            extends: "./tsconfig.json",
            exclude: ["src/**/*.test.ts", "src/tests/**"],
          },
          null,
          2,
        ) + "\n",
      );
    } catch {
      /* no-op */
    }
  }
}

export async function fixAppTsconfigs(dest: string, appTsconfigPaths: string[]): Promise<void> {
  for (const rel of appTsconfigPaths) {
    const full = path.join(dest, rel);
    try {
      const raw = await readFile(full, "utf-8");
      const cfg = JSON.parse(raw);
      delete cfg.references;
      await writeFile(full, JSON.stringify(cfg, null, 2) + "\n");
    } catch {
      /* no-op */
    }
  }
}

export async function regenerateTsconfigBase(dest: string, config: ExtractConfig): Promise<void> {
  const compilerOptions: Record<string, unknown> = {
    composite: true,
    declarationMap: true,
    emitDeclarationOnly: true,
    importHelpers: true,
    isolatedModules: true,
    lib: ["es2022"],
    module: "nodenext",
    moduleResolution: "nodenext",
    noEmitOnError: true,
    noFallthroughCasesInSwitch: true,
    noImplicitOverride: true,
    noImplicitReturns: true,
    noUnusedLocals: true,
    skipLibCheck: true,
    strict: true,
    target: "es2022",
  };

  if (config.customConditions && config.customConditions.length > 0) {
    compilerOptions.customConditions = config.customConditions;
  }

  const baseTsconfig = { compilerOptions };
  await writeFile(
    path.join(dest, "tsconfig.base.json"),
    JSON.stringify(baseTsconfig, null, 2) + "\n",
  );
  console.log("  regenerated tsconfig.base.json");
}

export async function findAppTsconfigs(dest: string, appDirs: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const appDir of appDirs) {
    const fullDir = path.join(dest, appDir);
    await walkForTsconfigs(fullDir, appDir, results);
  }
  return results;
}

async function walkForTsconfigs(dir: string, relDir: string, results: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isIgnored(entry.name)) continue;
      await walkForTsconfigs(path.join(dir, entry.name), path.join(relDir, entry.name), results);
    } else if (entry.name === "tsconfig.json") {
      results.push(relDir.replace(/\\/g, "/") + "/tsconfig.json");
    }
  }
}

export async function findPackageJsonFiles(dest: string, dirs: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const dir of dirs) {
    const fullDir = path.join(dest, dir);
    await walkForPackageJson(fullDir, dir, results);
  }
  return results;
}

async function walkForPackageJson(dir: string, relDir: string, results: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isIgnored(entry.name)) continue;
      await walkForPackageJson(path.join(dir, entry.name), path.join(relDir, entry.name), results);
    } else if (entry.name === "package.json") {
      results.push(relDir.replace(/\\/g, "/") + "/package.json");
    }
  }
}

export function buildGitignore(extraLines: string[] = [], config?: ExtractConfig): string {
  const mode = config?.gitignoreMode ?? "extended";
  const base = [
    ".env",
    ".env.*",
    "",
    "# Build outputs",
    "dist",
    "node_modules",
    "",
    "# Workspace",
    ".turbo",
    "",
    "# TypeScript",
    "*.tsbuildinfo",
    "",
    "# OS files",
    ".DS_Store",
    "Thumbs.db",
  ];

  if (mode === "extended") {
    const extended = [...base.slice(0, 6), ".output", ".debug", ".debug-public", ...base.slice(6)];
    const extra = extraLines.length > 0 ? ["", ...extraLines] : [];
    return [...extended, ...extra].join("\n");
  }

  const extra = extraLines.length > 0 ? ["", ...extraLines] : [];
  return [...base, ...extra].join("\n");
}

export function buildRootPackageJson(destName: string, config: ExtractConfig): object {
  return {
    name: config.rootPackageName ?? `exported-${destName}`,
    private: true,
    scripts: {
      build: 'pnpm --recursive --filter "./apps/**" exec pnpm run build',
      typecheck: 'pnpm --recursive --filter "./apps/**" exec pnpm run typecheck',
      lint: 'pnpm --recursive --filter "./apps/**" exec pnpm run lint',
      test: 'pnpm --recursive --filter "./apps/**" exec pnpm run --if-present test',
    },
    devDependencies: {
      "@eslint/js": "^10.0.1",
      "@types/node": "^22.10.0",
      eslint: "~10.7.0",
      tsx: "^4.22.3",
      typescript: "~6.0.3",
      "typescript-eslint": "^8.64.0",
    },
    ...(config.packageManager ? { packageManager: config.packageManager } : {}),
  };
}

export async function generateRootFiles(
  dest: string,
  root: string,
  config: ExtractConfig,
  packageDirs: string[],
  appDirs: string[],
): Promise<void> {
  await writeFile(
    path.join(dest, "package.json"),
    JSON.stringify(buildRootPackageJson(config.destName, config), null, 2) + "\n",
  );

  const workspaceEntries = new Set<string>();
  workspaceEntries.add("packages/*");
  workspaceEntries.add("packages/*/*");
  for (const appDir of appDirs) {
    const parts = appDir.split("/");
    if (parts.length >= 2) {
      workspaceEntries.add(`${parts.slice(0, -1).join("/")}/*`);
    }
    if (parts.length >= 3) {
      workspaceEntries.add(`${appDir}/*`);
    }
    if (parts.length === 2) {
      workspaceEntries.add("apps/*");
    }
  }

  const workspaceYamlLines = [
    "packages:",
    ...Array.from(workspaceEntries)
      .sort()
      .map((e) => `  - ${e}`),
    "",
  ];

  if (config.onlyBuiltDependencies && config.onlyBuiltDependencies.length > 0) {
    workspaceYamlLines.push("onlyBuiltDependencies:");
    for (const dep of config.onlyBuiltDependencies) {
      workspaceYamlLines.push(`  - '${dep}'`);
    }
    workspaceYamlLines.push("");
  }

  await writeFile(path.join(dest, "pnpm-workspace.yaml"), workspaceYamlLines.join("\n"));

  await writeFile(path.join(dest, ".gitignore"), buildGitignore(config.extraGitignore, config));

  const appRefs: { path: string }[] = [];
  for (const appDir of appDirs) {
    const srcTsconfig = path.join(root, appDir, "tsconfig.json");
    try {
      await access(srcTsconfig);
      appRefs.push({ path: `./${appDir}` });
    } catch {
      /* no tsconfig.json at this level — skip */
    }
  }
  const references = [...packageDirs.map((d) => ({ path: `./${d}` })), ...appRefs];
  const tsconfig = {
    extends: "./tsconfig.base.json",
    compileOnSave: false,
    files: [],
    references,
  };
  await writeFile(path.join(dest, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n");

  console.log("  generated: package.json, pnpm-workspace.yaml, .gitignore, tsconfig.json");
}

export async function cleanStrayArtifacts(dest: string): Promise<void> {
  for (const name of ["node_modules"]) {
    try {
      await rm(path.join(dest, name), { recursive: true, force: true });
    } catch {
      /* no-op */
    }
  }

  async function cleanDeep(dir: string) {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".turbo") {
          await rm(full, { recursive: true, force: true });
        } else {
          await cleanDeep(full);
        }
      } else if (e.name.endsWith(".tsbuildinfo") || e.name.endsWith(".db")) {
        await rm(full, { force: true });
      }
    }
  }
  await cleanDeep(dest);
}

export function generateCiWorkflow(): string {
  return [
    "name: CI",
    "",
    "on:",
    "  push:",
    "    branches: [main]",
    "  pull_request:",
    "",
    "permissions:",
    "  contents: read",
    "  id-token: write",
    "",
    "jobs:",
    "  ci:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 15",
    "    steps:",
    "      - uses: actions/checkout@v5",
    "      - uses: pnpm/action-setup@v6",
    "      - uses: actions/setup-node@v5",
    "        with:",
    "          node-version: 22",
    "          cache: pnpm",
    "      - run: pnpm install --frozen-lockfile",
    "      - run: pnpm run lint",
    "      - run: pnpm run typecheck",
    "      - run: pnpm run build",
    "      - run: pnpm test",
    "      - run: npm publish --provenance --access public",
    "        env:",
    "          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
    "",
  ].join("\n");
}

export async function fixStandalonePackageJson(dest: string, config: ExtractConfig): Promise<void> {
  const pkgPath = path.join(dest, "package.json");
  let raw: string;
  try {
    raw = await readFile(pkgPath, "utf-8");
  } catch {
    return;
  }

  const pkg = JSON.parse(raw);
  let changed = false;

  const stripScopes = config.stripScopes ?? config.workspacePrefixes ?? [];
  const preservePackages = config.preservePackages ?? [];

  if (pkg.scripts?.test && typeof pkg.scripts.test === "string") {
    if (
      pkg.scripts.test.includes("--dir ../../..") ||
      pkg.scripts.test.includes("--config packages/")
    ) {
      pkg.scripts.test = "vitest run";
      changed = true;
    }
  }

  for (const depField of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (pkg[depField]) {
      for (const key of Object.keys(pkg[depField])) {
        if (depField === "peerDependencies") {
          if (pkg[depField][key] === "workspace:*") {
            pkg[depField][key] = "*";
            changed = true;
          }
        } else {
          const shouldStrip = stripScopes.some((scope) => key.startsWith(scope));
          const shouldPreserve = preservePackages.includes(key);
          if (shouldStrip && !shouldPreserve) {
            delete pkg[depField][key];
            changed = true;
          } else if (pkg[depField][key] === "workspace:*") {
            pkg[depField][key] = "*";
            changed = true;
          }
        }
      }
      if (Object.keys(pkg[depField]).length === 0) {
        delete pkg[depField];
      }
    }
  }

  if (!pkg.packageManager && config.packageManager) {
    pkg.packageManager = config.packageManager;
    changed = true;
  }

  if (changed) {
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    console.log("  fixed standalone package.json (test script, workspace deps, packageManager)");
  }
}

export async function fixStandaloneVitestConfig(dest: string): Promise<void> {
  const configPath = path.join(dest, "vitest.config.ts");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    return;
  }

  const fixed = raw.replace(/["']packages\/[^/]+\/(tests\/\*\*\/\*\.test\.ts)["']/g, '"$1"');

  if (fixed !== raw) {
    await writeFile(configPath, fixed, "utf-8");
    console.log("  fixed vitest.config.ts (relative test paths)");
  }
}
