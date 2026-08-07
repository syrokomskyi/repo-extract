/*
<MODULE_CONTRACT>
<purpose>Core extraction orchestrator — monorepo and standalone modes.</purpose>
<non-goals>
  <item>Does not parse CLI args (see cli.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial extractProject orchestrator for RFC-0070. Ports main() and exportStandalonePackage() from scripts/export-clients.ts.</item>
  <item>RFC-0071: Replaced hardcoded destBase, AI files, copyDirs defaults with config-driven options. Pass config to transform functions.</item>
  <item>RFC-0072: Added detectPackageManager, parameterized install command, CI workflow, and all transform functions for pnpm/npm/yarn.</item>
</CHANGE_SUMMARY>
*/

import { stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import * as path from "node:path";
import type { ExtractConfig, ExtractContext, ExtractOptions, PackageManager } from "./types.js";
import {
  getMonorepoConfigFiles,
  copyBatchSample,
  copyFiltered,
  copyStandalonePackage,
  ensureDir,
  isIgnored,
  removeDest,
} from "./fs/copy.js";
import {
  cleanStrayArtifacts,
  findAppTsconfigs,
  findPackageJsonFiles,
  fixAppTsconfigs,
  fixPackageTsconfigs,
  fixStandalonePackageJson,
  fixStandaloneVitestConfig,
  generateCiWorkflow,
  generateRootFiles,
  regenerateTsconfigBase,
  transformPackageJson,
} from "./fs/transform.js";
import { discoverPackageDeps } from "./fs/discover.js";
import { runPostProcess } from "./postprocess/index.js";
import { commitExport, transferGitHistory } from "./fs/git.js";
import { tryGenerateChangelog } from "./changelog.js";
import { scanForSecrets } from "./scan.js";
import { detectPackageManager } from "./package-manager.js";

const HTML_LIMIT = 5;

export async function extractProject(
  config: ExtractConfig,
  options: ExtractOptions = {},
): Promise<void> {
  const root = process.cwd();
  const destBase =
    config.destBase ?? (config.projectDir.startsWith("packages/") ? "packages" : "exports");
  const dest = options.dest ?? path.resolve(root, "..", destBase, config.destName);

  console.log(`Exporting ${config.destName} to ${destBase}...`);
  console.log(`  source: ${root}`);
  console.log(`  dest:   ${dest}`);
  console.log("");

  if (options.dryRun) {
    console.log("=== Dry run — no files will be written ===");
    console.log(`  projectDir: ${config.projectDir}`);
    console.log(`  destName: ${config.destName}`);
    console.log(`  standalone: ${config.standalone}`);
    console.log(`  appDirs: ${config.appDirs.join(", ") || "(none)"}`);
    if (config.postProcess) {
      console.log(`  postProcess rules: ${config.postProcess.length}`);
    }
    return;
  }

  if (config.standalone || config.projectDir.startsWith("packages/")) {
    await exportStandalonePackage(root, dest, config);
  } else {
    await exportMonorepo(root, dest, config);
  }
}

async function exportMonorepo(root: string, dest: string, config: ExtractConfig): Promise<void> {
  const pm: PackageManager = config.packageManager ?? detectPackageManager(root);
  const projectDir = path.join(root, config.projectDir);

  // 0. Generate changelog
  let changelogCommitMessage = `chore(${config.destName}): export ${new Date().toISOString().slice(0, 10)}`;
  const changelogResult = await tryGenerateChangelog(projectDir);
  if (!changelogResult.skipped && changelogResult.commitMessage) {
    changelogCommitMessage = `chore(${config.destName}): export ${new Date().toISOString().slice(0, 10)} — ${changelogResult.commitMessage}`;
  }

  // 1. Clean destination
  console.log("Cleaning destination...");
  await removeDest(dest);
  await ensureDir(dest);

  // 2. Copy monorepo config files
  console.log("Copying monorepo config files...");
  const monorepoFiles = config.monorepoConfigFiles ?? getMonorepoConfigFiles(pm);
  for (const file of monorepoFiles) {
    const src = path.join(root, file);
    const destPath = path.join(dest, file);
    try {
      const { cp } = await import("node:fs/promises");
      await cp(src, destPath);
      console.log(`  copied: ${file}`);
    } catch {
      console.log(`  skipped (not found): ${file}`);
    }
  }

  // 2b. Copy project-specific root files
  if (config.projectRootFiles && config.projectRootFiles.length > 0) {
    console.log(`Copying project root files from ${config.projectDir}/...`);
    for (const file of config.projectRootFiles) {
      const src = path.join(root, config.projectDir, file);
      const destPath = path.join(dest, file);
      try {
        const { cp } = await import("node:fs/promises");
        await cp(src, destPath);
        console.log(`  copied: ${file}`);
      } catch {
        console.log(`  skipped (not found): ${file}`);
      }
    }
  }

  // 3. Copy AI ecosystem files
  console.log("Copying AI agent ecosystem...");
  const aiFiles = config.aiEcosystemFiles ?? [];
  for (const f of aiFiles) {
    const src = path.join(root, f);
    const destPath = path.join(dest, f);
    try {
      const { cp } = await import("node:fs/promises");
      await cp(src, destPath);
      console.log(`  copied: ${f}`);
    } catch {
      console.log(`  skipped (not found): ${f}`);
    }
  }

  for (const copyDir of config.copyDirs ?? []) {
    const src = path.join(root, copyDir);
    const destPath = path.join(dest, copyDir);
    try {
      const { cp } = await import("node:fs/promises");
      await cp(src, destPath, {
        recursive: true,
        filter: (s: string) => {
          const name = path.basename(s);
          return !isIgnored(name) && !name.endsWith(".tsbuildinfo");
        },
      });
      console.log(`  copied: ${copyDir}/`);
    } catch {
      console.log(`  skipped: ${copyDir}/ (not found)`);
    }
  }

  // 4. Generate root files
  console.log("Generating export root files...");

  let packageDirs = config.packageDirs;
  if (!packageDirs) {
    console.log("Auto-discovering package dependencies...");
    packageDirs = await discoverPackageDeps(root, config.appDirs, config.workspacePrefixes);
    console.log(`  found ${packageDirs.length} packages: ${packageDirs.join(", ")}`);
  }

  await generateRootFiles(dest, root, config, packageDirs, config.appDirs, pm);

  // 5. Copy apps with filtering
  console.log("Copying apps...");
  let appFiles = 0;
  for (const appDir of config.appDirs) {
    const src = path.join(root, appDir);
    const s = await stat(src).catch(() => null);
    if (!s?.isDirectory()) {
      console.log(`  skipped (not found): ${appDir}`);
      continue;
    }
    const n = await copyFiltered(root, dest, appDir, config.ignoreDirs);
    appFiles += n;
    console.log(`  copied ${n} files: ${appDir}`);
  }

  // 6. Copy packages with filtering
  console.log("Copying packages...");
  let pkgFiles = 0;
  for (const pkgDir of packageDirs) {
    const src = path.join(root, pkgDir);
    const s = await stat(src).catch(() => null);
    if (!s?.isDirectory()) {
      console.log(`  skipped (not found): ${pkgDir}`);
      continue;
    }
    const n = await copyFiltered(root, dest, pkgDir, config.ignoreDirs);
    pkgFiles += n;
    console.log(`  copied ${n} files: ${pkgDir}`);
  }

  // 7. Fix package tsconfig files
  console.log("Fixing package tsconfig files...");
  await fixPackageTsconfigs(dest, packageDirs);

  // 8. Fix app tsconfig files
  console.log("Fixing app tsconfig files...");
  const appTsconfigPaths = await findAppTsconfigs(dest, config.appDirs);
  await fixAppTsconfigs(dest, appTsconfigPaths);

  // 9. Run post-process rules
  if (config.postProcess && config.postProcess.length > 0) {
    console.log("Running post-process rules...");
    const ctx: ExtractContext = { root, dest, config, packageDirs };
    await runPostProcess(ctx, config.postProcess);
  }

  // 10. Regenerate tsconfig.base.json
  await regenerateTsconfigBase(dest, config);

  // 11. Sample batch data (if configured)
  if (config.batchDataDir) {
    console.log("Sampling batch data...");
    const batchSrc = path.join(root, config.batchDataDir);
    const batchDest = path.join(dest, config.batchDataDir);
    if (
      await stat(batchSrc)
        .then((s) => s.isDirectory())
        .catch(() => false)
    ) {
      await copyBatchSample(batchSrc, batchDest, HTML_LIMIT);
    } else {
      console.log("  batch data directory not found, skipping");
    }
  }

  // 12. Transform package.json files
  console.log("Transforming package.json files...");
  const allDirs = [...config.appDirs, ...packageDirs];
  const pkgJsonFiles = await findPackageJsonFiles(dest, allDirs);
  for (const rel of pkgJsonFiles) {
    await transformPackageJson(dest, rel, config);
  }

  // 13. Generate lockfile
  console.log(`Generating ${pm} lockfile...`);
  const installCmd =
    pm === "pnpm" ? "pnpm install" : pm === "yarn" ? "yarn install" : "npm install";
  try {
    execSync(installCmd, { cwd: dest, stdio: "pipe" });
    console.log(`  generated ${pm} lockfile`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ${pm} install FAILED — lockfile not generated`);
    console.error(`  ${msg.slice(0, 500)}`);
    throw err;
  }

  // 14. Cleanup stray artifacts
  console.log("Cleaning stray artifacts...");
  await cleanStrayArtifacts(dest);

  // 14b. Generate CI workflow
  console.log("Generating CI workflow...");
  const { mkdir: ciMkdir, writeFile: ciWrite } = await import("node:fs/promises");
  const ciDir = path.join(dest, ".github", "workflows");
  await ciMkdir(ciDir, { recursive: true });
  const ciContent = generateCiWorkflow(pm, config.ci);
  if (ciContent) {
    await ciWrite(path.join(ciDir, "ci.yml"), ciContent);
    console.log("  generated .github/workflows/ci.yml");
  } else {
    console.log("  skipped CI workflow (provider: none)");
  }

  // 15. Summary
  console.log("");
  console.log("=== Export complete ===");
  console.log(`  destination: ${dest}`);
  console.log(`  apps files:  ${appFiles}`);
  console.log(`  package files: ${pkgFiles}`);

  // 15b. Secret scan — abort before git commit if secrets found
  if (!config.skipSecretScan) {
    console.log("Scanning for secrets...");
    const findings = await scanForSecrets(dest);
    if (findings.length > 0) {
      console.error(`\n!!! ABORTED: ${findings.length} secret(s) detected in export !!!`);
      for (const f of findings) {
        console.error(`  ${f.file}:${f.line} — ${f.name}`);
        console.error(`    ${f.preview}`);
      }
      console.error(
        "\nExport aborted. Fix the source files or add directories to ignoreDirs in config.",
      );
      process.exit(1);
    }
    console.log("  no secrets found");
  }

  // 16. Transfer git history (by path prefix)
  const historyPrefixes = [config.projectDir, ...packageDirs];
  await transferGitHistory(root, dest, historyPrefixes);

  // 17. Git commit + push
  await commitExport(dest, changelogCommitMessage, config.git);
}

async function exportStandalonePackage(
  root: string,
  dest: string,
  config: ExtractConfig,
): Promise<void> {
  const pm: PackageManager = config.packageManager ?? detectPackageManager(root);
  const changelogCommitMessage = `chore(${config.destName}): export ${new Date().toISOString().slice(0, 10)}`;

  // 1. Clean destination
  console.log("Cleaning destination...");
  await removeDest(dest);
  await ensureDir(dest);

  // 2. Copy package contents
  console.log("Copying standalone package...");
  const fileCount = await copyStandalonePackage(root, dest, config.projectDir, config.ignoreDirs);
  console.log(`  copied ${fileCount} files`);

  // 3. Rewrite tsconfig.json to be self-contained
  console.log("Rewriting tsconfig.json (self-contained)...");
  const tsconfigPath = path.join(dest, "tsconfig.json");
  const { readFile, writeFile } = await import("node:fs/promises");
  const { readFileSync } = await import("node:fs");
  try {
    const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf-8"));
    if (tsconfig.extends && tsconfig.extends.includes("../")) {
      const srcTsconfigPath = path.join(root, config.projectDir, "tsconfig.json");
      const srcTsconfig = JSON.parse(readFileSync(srcTsconfigPath, "utf-8"));
      const basePath = path.resolve(path.dirname(srcTsconfigPath), srcTsconfig.extends);
      const baseConfig = JSON.parse(readFileSync(basePath, "utf-8"));
      tsconfig.compilerOptions = {
        ...baseConfig.compilerOptions,
        ...tsconfig.compilerOptions,
      };
      delete tsconfig.extends;
      delete tsconfig.compilerOptions.customConditions;
      await writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n");
      console.log("  inlined base config, removed customConditions");
    } else {
      console.log("  no extends to inline, skipping");
    }
  } catch {
    console.log("  no tsconfig.json found, skipping");
  }

  // 4. Write .gitignore
  const gitignoreContent = [
    "node_modules",
    "dist",
    "*.tsbuildinfo",
    ".env",
    ".env.*",
    "!.env.example",
    ".turbo",
    ".DS_Store",
    "Thumbs.db",
    "",
  ].join("\n");
  await writeFile(path.join(dest, ".gitignore"), gitignoreContent);
  console.log("  wrote .gitignore");

  // 4b. Fix standalone package.json (test script, workspace deps)
  console.log("Fixing standalone package.json...");
  await fixStandalonePackageJson(dest, config, pm, root);

  // 4c. Fix vitest.config.ts (relative test paths)
  console.log("Fixing vitest.config.ts...");
  await fixStandaloneVitestConfig(dest);

  // 5. Clean stray artifacts
  console.log("Cleaning stray artifacts...");
  await cleanStrayArtifacts(dest);

  // 5b. Generate CI workflow
  console.log("Generating CI workflow...");
  const { mkdir: ciMkdir, writeFile: ciWrite } = await import("node:fs/promises");
  const ciDir = path.join(dest, ".github", "workflows");
  await ciMkdir(ciDir, { recursive: true });
  const ciContent = generateCiWorkflow(pm, config.ci);
  if (ciContent) {
    await ciWrite(path.join(ciDir, "ci.yml"), ciContent);
    console.log("  generated .github/workflows/ci.yml");
  } else {
    console.log("  skipped CI workflow (provider: none)");
  }

  // 6. Summary
  console.log("");
  console.log("=== Export complete ===");
  console.log(`  destination: ${dest}`);

  // 6b. Secret scan — abort before git commit if secrets found
  if (!config.skipSecretScan) {
    console.log("Scanning for secrets...");
    const findings = await scanForSecrets(dest);
    if (findings.length > 0) {
      console.error(`\n!!! ABORTED: ${findings.length} secret(s) detected in export !!!`);
      for (const f of findings) {
        console.error(`  ${f.file}:${f.line} — ${f.name}`);
        console.error(`    ${f.preview}`);
      }
      console.error(
        "\nExport aborted. Fix the source files or add directories to ignoreDirs in config.",
      );
      process.exit(1);
    }
    console.log("  no secrets found");
  }

  // 7. Transfer git history (by path prefix)
  await transferGitHistory(root, dest, [config.projectDir]);

  // 8. Git commit + push
  await commitExport(dest, changelogCommitMessage, config.git);
}
