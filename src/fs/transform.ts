/*
<MODULE_CONTRACT>
<purpose>Package.json and tsconfig transformation utilities for exported repos. for reliable use by its direct callers and maintainers.</purpose>
<non-goals>
  <item>Does not copy files (see copy.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Ported transformPackageJson, fixPackageTsconfigs, fixAppTsconfigs, regenerateTsconfigBase, generateRootFiles from scripts/export-clients-helpers.ts for RFC-0070.</item>
  <item>ADR-0010: added lint step, npm publish --provenance, and id-token: write to generateCiWorkflow()</item>
  <item>RFC-0071: Replaced hardcoded org-specific values with config-driven options (stripScopes, preservePackages, rootPackageName, customConditions, onlyBuiltDependencies, packageManager, gitignoreMode).</item>
  <item>RFC-0072: Parameterized buildRootPackageJson, generateRootFiles, generateCiWorkflow, fixStandalonePackageJson for pnpm/npm/yarn support.</item>
  <item>Fix: Split generateCiWorkflow into ci + publish jobs — publish only on push to main, with registry-url for NODE_AUTH_TOKEN.</item>
  <item>ADR-0082: preservePackages workspace:* deps now pin to ^&lt;sourceVersion&gt; instead of * — extracted lockfiles resolve the just-published sibling under pnpm minimumReleaseAge.</item>
  <item>RFC-1081: Added gh release create step after npm publish with --generate-notes and || true for tag collision. Updated publish job permissions to contents: write. (Ported back from standalone repo — was committed there directly on 2026-09-13.)</item>
  <item>RFC-0132: standalone manifest self-healing — ensureTypecheckScript (build+--noEmit), ensureRepositoryField (from git.remote), ensureTestScriptTolerant (--passWithNoTests when no test files ship).</item>
</CHANGE_SUMMARY>
*/

import { readFile, writeFile, rm, access, readdir } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import type { ExtractConfig, PackageManager, CiConfig } from "../types.js";
import type { Logger } from "../log.js";
import { isIgnored } from "./copy.js";
import { resolveSourceVersion } from "./discover.js";

export async function transformPackageJson(
  dest: string,
  relPath: string,
  config: ExtractConfig,
  logger?: Logger,
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
    (logger?.log ?? console.log)(`  transformed: ${relPath}`);
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

export async function regenerateTsconfigBase(
  dest: string,
  config: ExtractConfig,
  logger?: Logger,
): Promise<void> {
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
  (logger?.log ?? console.log)("  regenerated tsconfig.base.json");
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
    const extra = extraLines.length > 0 ? ["", ...extraLines] : [];
    return [...base, ...extra].join("\n");
  }

  const extra = extraLines.length > 0 ? ["", ...extraLines] : [];
  return [...base, ...extra].join("\n");
}

function rootScripts(pm: PackageManager, workspaceFilter?: string): Record<string, string> {
  if (pm === "npm") {
    return {
      build: "npm run build --workspaces --if-present",
      typecheck: "npm run typecheck --workspaces --if-present",
      lint: "npm run lint --workspaces --if-present",
      test: "npm test --workspaces --if-present",
    };
  }
  if (pm === "yarn") {
    return {
      build: "yarn workspaces foreach run build",
      typecheck: "yarn workspaces foreach run typecheck",
      lint: "yarn workspaces foreach run lint",
      test: "yarn workspaces foreach run test",
    };
  }
  if (workspaceFilter) {
    const f = `pnpm --filter ${workspaceFilter}... run --if-present`;
    return {
      build: `${f} build`,
      typecheck: `${f} typecheck`,
      lint: `${f} lint`,
      test: `${f} test`,
    };
  }
  return {
    build: "pnpm -r run --if-present build",
    typecheck: "pnpm -r run --if-present typecheck",
    lint: "pnpm -r run --if-present lint",
    test: "pnpm -r run --if-present test",
  };
}

function detectSourcePackageManagerVersion(root: string): string | undefined {
  try {
    const rootPkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8"));
    return rootPkg.packageManager;
  } catch {
    return undefined;
  }
}

export function buildRootPackageJson(
  destName: string,
  config: ExtractConfig,
  pm: PackageManager,
  root?: string,
): object {
  const pkg: Record<string, unknown> = {
    name: config.rootPackageName ?? `exported-${destName}`,
    private: true,
    scripts: rootScripts(pm, config.ci?.workspaceFilter),
    devDependencies: {
      "@eslint/js": "^10.0.1",
      "@types/node": "^22.10.0",
      eslint: "~10.7.0",
      tsx: "^4.22.3",
      typescript: "~6.0.3",
      "typescript-eslint": "^8.64.0",
    },
  };

  if (pm === "pnpm") {
    const version = root ? detectSourcePackageManagerVersion(root) : undefined;
    if (version) {
      pkg.packageManager = version;
    }
  }

  return pkg;
}

export async function generateRootFiles(
  dest: string,
  root: string,
  config: ExtractConfig,
  packageDirs: string[],
  appDirs: string[],
  pm: PackageManager,
  logger?: Logger,
): Promise<void> {
  const rootPkg = buildRootPackageJson(config.destName, config, pm, root);

  if (pm === "pnpm") {
    // pnpm: write pnpm-workspace.yaml, add onlyBuiltDependencies if configured
    await writeFile(path.join(dest, "package.json"), JSON.stringify(rootPkg, null, 2) + "\n");

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
  } else {
    // npm/yarn: add workspaces field to root package.json, no separate workspace file
    const workspaceEntries = ["packages/*", "packages/*/*"];
    for (const appDir of appDirs) {
      const parts = appDir.split("/");
      if (parts.length >= 2) {
        workspaceEntries.push(`${parts.slice(0, -1).join("/")}/*`);
      }
      if (parts.length >= 3) {
        workspaceEntries.push(`${appDir}/*`);
      }
      if (parts.length === 2) {
        workspaceEntries.push("apps/*");
      }
    }
    (rootPkg as Record<string, unknown>).workspaces = Array.from(new Set(workspaceEntries)).sort();
    await writeFile(path.join(dest, "package.json"), JSON.stringify(rootPkg, null, 2) + "\n");
  }

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

  const workspaceFile = pm === "pnpm" ? "pnpm-workspace.yaml" : "(workspaces in package.json)";
  (logger?.log ?? console.log)(
    `  generated: package.json, ${workspaceFile}, .gitignore, tsconfig.json`,
  );
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

export function generateCiWorkflow(
  pm: PackageManager,
  ci?: CiConfig,
  opts?: { lockfileShips?: boolean },
): string | null {
  if (ci?.provider === "none") return null;

  const nodeVersion = ci?.nodeVersion ?? 22;
  const publish = ci?.publish ?? true;
  // Lockfile may be excluded from the export (e.g. it embeds a local `link:`
  // dep that cannot resolve on CI). Emitting `cache: <pm>`/`--frozen-lockfile`
  // for a lockfile-less repo fails before install even starts.
  const lockfileShips = opts?.lockfileShips ?? true;

  const installCmd =
    pm === "pnpm"
      ? `pnpm install ${lockfileShips ? "--frozen-lockfile " : "--no-frozen-lockfile "}--config.dangerouslyAllowAllBuilds=true`
      : pm === "yarn"
        ? `yarn install${lockfileShips ? " --frozen-lockfile" : ""}`
        : lockfileShips
          ? "npm ci"
          : "npm install";
  const runPrefix = pm === "pnpm" ? "pnpm run" : pm === "yarn" ? "yarn" : "npm run";
  const testCmd = pm === "pnpm" ? "pnpm test" : pm === "yarn" ? "yarn test" : "npm test";
  const cacheKey = pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npm";
  // setup-node's cache needs a committed lockfile — skip it when none ships.
  // pnpm/action-setup@v6's `cache` (default true) also injects
  // `package-manager-cache: true` into setup-node's resolved inputs, which
  // hard-fails on a missing lockfile — the override must land on setup-node
  // itself; action-setup's own `cache: false` does not retract the injection.
  const cacheLines = lockfileShips
    ? [`          cache: ${cacheKey}`]
    : ["          package-manager-cache: false"];

  const pnpmSetup =
    pm === "pnpm"
      ? lockfileShips
        ? ["      - uses: pnpm/action-setup@v6"]
        : ["      - uses: pnpm/action-setup@v6", "        with:", "          cache: false"]
      : [];

  const ciSetupSteps = [
    "      - uses: actions/checkout@v5",
    ...pnpmSetup,
    "      - uses: actions/setup-node@v5",
    "        with:",
    `          node-version: ${nodeVersion}`,
    ...cacheLines,
    `      - run: ${installCmd}`,
  ];

  const buildSteps: string[] = [];
  if (!ci?.skipBuild) {
    buildSteps.push(`      - run: ${runPrefix} build`);
  }
  buildSteps.push(
    `      - run: ${runPrefix} lint`,
    `      - run: ${runPrefix} typecheck`,
    `      - run: ${testCmd}`,
  );

  const lines: string[] = [
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
    ...ciSetupSteps,
    ...buildSteps,
  ];

  if (publish) {
    lines.push(
      "",
      "  publish:",
      "    needs: ci",
      "    if: github.event_name == 'push'",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 10",
      "    permissions:",
      "      contents: write",
      "      id-token: write",
      "    steps:",
      "      - uses: actions/checkout@v5",
      ...pnpmSetup,
      "      - uses: actions/setup-node@v5",
      "        with:",
      `          node-version: ${nodeVersion}`,
      ...cacheLines,
      "          registry-url: https://registry.npmjs.org",
      `      - run: ${installCmd}`,
      `      - run: ${runPrefix} build`,
      "      - run: npm publish --provenance --access public",
      "        env:",
      "          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
      "      - name: Create GitHub Release",
      "        if: github.ref == 'refs/heads/main' && github.event_name == 'push'",
      "        run: |",
      "          VERSION=$(node -p \"require('./package.json').version\")",
      '          gh release create "v${VERSION}" \\',
      '            --title "v${VERSION}" \\',
      "            --generate-notes \\",
      "            --latest || true",
      "        env:",
      "          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    );
  }

  if (ci?.deploy?.provider === "cloudflare-pages") {
    const d = ci.deploy;
    const envLines = [
      "          " + d.apiTokenSecret + ": ${{ secrets." + d.apiTokenSecret + " }}",
    ];
    if (d.accountIdSecret) {
      envLines.push(
        "          " + d.accountIdSecret + ": ${{ secrets." + d.accountIdSecret + " }}",
      );
    }
    lines.push(
      "",
      "  deploy:",
      "    needs: ci",
      "    if: github.event_name == 'push'",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 15",
      "    permissions:",
      "      contents: read",
      "    steps:",
      "      - uses: actions/checkout@v5",
      ...pnpmSetup,
      "      - uses: actions/setup-node@v5",
      "        with:",
      `          node-version: ${nodeVersion}`,
      `          cache: ${cacheKey}`,
      `      - run: ${installCmd}`,
      `      - run: ${d.buildCommand}`,
      `      - run: npx wrangler deploy`,
      "        working-directory: " + d.outputDir,
      "        env:",
      ...envLines,
    );
  }

  lines.push("");
  return lines.join("\n");
}

export async function bumpSourceVersion(
  root: string,
  config: ExtractConfig,
  logger?: Logger,
): Promise<void> {
  if (!config.versionBump) return;

  const srcPkgPath = path.join(root, config.projectDir, "package.json");
  let raw: string;
  try {
    raw = await readFile(srcPkgPath, "utf-8");
  } catch {
    return;
  }

  const pkg = JSON.parse(raw);
  if (!pkg.version) return;

  const parts = String(pkg.version).split(".");
  if (parts.length !== 3) return;

  let [major, minor, patch] = parts.map(Number);
  if (config.versionBump === "major") {
    major++;
    minor = 0;
    patch = 0;
  } else if (config.versionBump === "minor") {
    minor++;
    patch = 0;
  } else {
    patch++;
  }

  const oldVersion = pkg.version;
  pkg.version = `${major}.${minor}.${patch}`;
  await writeFile(srcPkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  (logger?.log ?? console.log)(
    `  bumped source version ${oldVersion} → ${pkg.version} (${config.versionBump})`,
  );
}

export async function fixStandalonePackageJson(
  dest: string,
  config: ExtractConfig,
  pm: PackageManager,
  root?: string,
  logger?: Logger,
): Promise<void> {
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
            pkg[depField][key] = await rewriteWorkspaceSpecifier(
              key,
              preservePackages,
              root,
              logger,
            );
            changed = true;
          }
        } else {
          const shouldStrip = stripScopes.some((scope) => key.startsWith(scope));
          const shouldPreserve = preservePackages.includes(key);
          if (shouldStrip && !shouldPreserve) {
            delete pkg[depField][key];
            changed = true;
          } else if (pkg[depField][key] === "workspace:*") {
            pkg[depField][key] = await rewriteWorkspaceSpecifier(
              key,
              preservePackages,
              root,
              logger,
            );
            changed = true;
          }
        }
      }
      if (Object.keys(pkg[depField]).length === 0) {
        delete pkg[depField];
      }
    }
  }

  if (pm === "pnpm" && !pkg.packageManager) {
    const version = root ? detectSourcePackageManagerVersion(root) : undefined;
    if (version) {
      pkg.packageManager = version;
      changed = true;
    }
  }

  // RFC-0132: heal the manifest against the generated-CI and npm-provenance
  // contracts — see ensureTypecheckScript / ensureRepositoryField /
  // ensureTestScriptTolerant for the exact shapes.
  if (ensureTypecheckScript(pkg, logger)) changed = true;
  if (ensureRepositoryField(pkg, config.git?.remote, logger)) changed = true;
  if (!hasAnyTestFiles(dest) && ensureTestScriptTolerant(pkg, logger)) changed = true;

  if (changed) {
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    (logger?.log ?? console.log)(
      "  fixed standalone package.json (test script, workspace deps, packageManager)",
    );
  }
}

/**
 * RFC-0132: generated CI always runs `<pm> run typecheck`. When the source
 * manifest has no typecheck script but builds via a single `tsc -p <file>`
 * invocation, synthesize `typecheck` as the same command plus `--noEmit`.
 * Only a single tsc invocation is rewritten — composed builds (`a && b`)
 * would append the flag to the wrong segment and stay a human fix.
 */
export function ensureTypecheckScript(
  pkg: { scripts?: Record<string, string> },
  logger?: Logger,
): boolean {
  const scripts = pkg.scripts;
  if (!scripts || typeof scripts.typecheck === "string" || typeof scripts.build !== "string") {
    return false;
  }
  const build = scripts.build.trim();
  if (/&&|\|\||;/.test(build) || !/(pnpm exec )?tsc -p \S+/.test(build)) return false;
  scripts.typecheck = `${build} --noEmit`;
  (logger?.log ?? console.log)(`  healed scripts.typecheck: "${scripts.typecheck}"`);
  return true;
}

/**
 * RFC-0132: `npm publish --provenance` verifies package.json repository.url
 * against the Actions repo slug. Synthesize the field from git.remote when
 * absent — accepting `git@host:owner/repo(.git)` and
 * `https://host/owner/repo(.git)`. A declared-but-mismatched repository is
 * left untouched: wrong data is a human decision, not a healing target.
 */
export function ensureRepositoryField(
  pkg: { repository?: unknown },
  remote: string | undefined,
  logger?: Logger,
): boolean {
  if (!remote || pkg.repository !== undefined) return false;
  const m =
    remote.match(/^[a-z]+@([^:/]+):([^/]+)\/(.+?)(?:\.git)?$/) ??
    remote.match(/^https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) return false;
  const [, host, owner, repo] = m;
  pkg.repository = { type: "git", url: `git+https://${host}/${owner}/${repo}.git` };
  (logger?.log ?? console.log)(`  healed repository: git+https://${host}/${owner}/${repo}.git`);
  return true;
}

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * RFC-0132: scan the exported tree for test files. Exclusion rules can strip
 * a package's whole test surface; the answer decides whether the test script
 * needs --passWithNoTests.
 */
export function hasAnyTestFiles(dir: string): boolean {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (hasAnyTestFiles(full)) return true;
    } else if (TEST_FILE_RE.test(e.name)) {
      return true;
    }
  }
  return false;
}

/**
 * RFC-0132: vitest exits 1 on an empty suite, and generated CI always runs
 * the test step. When the export ships no test files, make the script
 * tolerate it — shipping a later test file restores real coverage.
 */
export function ensureTestScriptTolerant(
  pkg: { scripts?: Record<string, string> },
  logger?: Logger,
): boolean {
  const test = pkg.scripts?.test;
  if (typeof test !== "string" || test.includes("passWithNoTests")) return false;
  if (!/vitest|jest/.test(test)) return false;
  pkg.scripts!.test = `${test} --passWithNoTests`;
  (logger?.log ?? console.log)(
    `  healed scripts.test: "${pkg.scripts!.test}" (no test files in export)`,
  );
  return true;
}

async function rewriteWorkspaceSpecifier(
  depName: string,
  preservePackages: string[],
  root?: string,
  logger?: Logger,
): Promise<string> {
  if (!root || !preservePackages.includes(depName)) return "*";
  const version = await resolveSourceVersion(root, depName);
  if (!version) {
    (logger?.log ?? console.log)(
      `  warning: could not resolve source version for preserved dep ${depName} — falling back to *`,
    );
    return "*";
  }
  return `^${version}`;
}

export async function fixStandaloneVitestConfig(dest: string, logger?: Logger): Promise<void> {
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
    (logger?.log ?? console.log)("  fixed vitest.config.ts (relative test paths)");
  }
}
