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
  <item>RFC-0073: replaced execSync with execFileSync (argument arrays) to eliminate shell injection.</item>
  <item>RFC-0074: Replaced process.exit(1) with SecretScanError. Changed return type to Promise<ExtractResult>. Added progress events, logger, PackageManagerError wrapping.</item>
  <item>RFC-0075: Consolidated all inline await import("node:fs*") to top-level static imports.</item>
</CHANGE_SUMMARY>
*/

import { stat, cp, mkdir, writeFile, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import type {
  ExtractConfig,
  ExtractContext,
  ExtractOptions,
  ExtractResult,
  ExtractProgressEvent,
  PackageManager,
} from "./types.js";
import { SecretScanError, PackageManagerError } from "./errors.js";
import { createLogger } from "./log.js";
import type { Logger } from "./log.js";
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
  buildGitignore,
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
): Promise<ExtractResult> {
  const root = process.cwd();
  const destBase =
    config.destBase ?? (config.projectDir.startsWith("packages/") ? "packages" : "exports");
  const dest = options.dest ?? path.resolve(root, "..", destBase, config.destName);
  const logger = createLogger(options.verbose);
  const onProgress = options.onProgress;

  const emit = (event: ExtractProgressEvent) => {
    try {
      onProgress?.(event);
    } catch {
      // callback errors are non-fatal
    }
  };

  logger.log(`Exporting ${config.destName} to ${destBase}...`);
  logger.log(`  source: ${root}`);
  logger.log(`  dest:   ${dest}`);
  logger.log("");

  if (options.dryRun) {
    logger.log("=== Dry run — no files will be written ===");
    logger.log(`  projectDir: ${config.projectDir}`);
    logger.log(`  destName: ${config.destName}`);
    logger.log(`  standalone: ${config.standalone}`);
    logger.log(`  appDirs: ${config.appDirs.join(", ") || "(none)"}`);
    if (config.postProcess) {
      logger.log(`  postProcess rules: ${config.postProcess.length}`);
    }
    const result: ExtractResult = {
      dest,
      mode: config.standalone ? "standalone" : "monorepo",
      filesCopied: 0,
      packagesCopied: 0,
      gitCommitted: false,
      gitPushed: false,
      changelogGenerated: false,
      secretsScanned: false,
    };
    emit({ phase: "complete", result });
    return result;
  }

  emit({ phase: "start", config, dest });

  try {
    if (config.standalone || config.projectDir.startsWith("packages/")) {
      return await exportStandalonePackage(root, dest, config, logger, emit);
    } else {
      return await exportMonorepo(root, dest, config, logger, emit);
    }
  } catch (err) {
    emit({ phase: "error", error: err instanceof Error ? err : new Error(String(err)) });
    throw err;
  }
}

async function exportMonorepo(
  root: string,
  dest: string,
  config: ExtractConfig,
  logger: Logger,
  emit: (event: ExtractProgressEvent) => void,
): Promise<ExtractResult> {
  const pm: PackageManager = config.packageManager ?? detectPackageManager(root);
  const projectDir = path.join(root, config.projectDir);

  // 0. Generate changelog
  let changelogCommitMessage = `chore(${config.destName}): export ${new Date().toISOString().slice(0, 10)}`;
  const changelogResult = await tryGenerateChangelog(projectDir);
  let changelogGenerated = false;
  if (!changelogResult.skipped && changelogResult.commitMessage) {
    changelogCommitMessage = `chore(${config.destName}): export ${new Date().toISOString().slice(0, 10)} — ${changelogResult.commitMessage}`;
    changelogGenerated = true;
  }

  // 1. Clean destination
  emit({ phase: "cleaning", dest });
  logger.log("Cleaning destination...");
  await removeDest(dest);
  await ensureDir(dest);

  // 2. Copy monorepo config files
  logger.log("Copying monorepo config files...");
  const monorepoFiles = config.monorepoConfigFiles ?? getMonorepoConfigFiles(pm);
  for (const file of monorepoFiles) {
    const src = path.join(root, file);
    const destPath = path.join(dest, file);
    try {
      await cp(src, destPath);
      logger.log(`  copied: ${file}`);
    } catch {
      logger.log(`  skipped (not found): ${file}`);
    }
  }

  // 2b. Copy project-specific root files
  if (config.projectRootFiles && config.projectRootFiles.length > 0) {
    logger.log(`Copying project root files from ${config.projectDir}/...`);
    for (const file of config.projectRootFiles) {
      const src = path.join(root, config.projectDir, file);
      const destPath = path.join(dest, file);
      try {
        await cp(src, destPath);
        logger.log(`  copied: ${file}`);
      } catch {
        logger.log(`  skipped (not found): ${file}`);
      }
    }
  }

  // 3. Copy AI ecosystem files
  logger.log("Copying AI agent ecosystem...");
  const aiFiles = config.aiEcosystemFiles ?? [];
  for (const f of aiFiles) {
    const src = path.join(root, f);
    const destPath = path.join(dest, f);
    try {
      await cp(src, destPath);
      logger.log(`  copied: ${f}`);
    } catch {
      logger.log(`  skipped (not found): ${f}`);
    }
  }

  for (const copyDir of config.copyDirs ?? []) {
    const src = path.join(root, copyDir);
    const destPath = path.join(dest, copyDir);
    try {
      await cp(src, destPath, {
        recursive: true,
        filter: (s: string) => {
          const name = path.basename(s);
          return !isIgnored(name) && !name.endsWith(".tsbuildinfo");
        },
      });
      logger.log(`  copied: ${copyDir}/`);
    } catch {
      logger.log(`  skipped: ${copyDir}/ (not found)`);
    }
  }

  // 4. Generate root files
  logger.log("Generating export root files...");

  let packageDirs = config.packageDirs;
  if (!packageDirs) {
    logger.log("Auto-discovering package dependencies...");
    packageDirs = await discoverPackageDeps(root, config.appDirs, config.workspacePrefixes);
    logger.log(`  found ${packageDirs.length} packages: ${packageDirs.join(", ")}`);
  }

  await generateRootFiles(dest, root, config, packageDirs, config.appDirs, pm);

  // 5. Copy apps with filtering
  logger.log("Copying apps...");
  let appFiles = 0;
  for (const appDir of config.appDirs) {
    const src = path.join(root, appDir);
    const s = await stat(src).catch(() => null);
    if (!s?.isDirectory()) {
      logger.log(`  skipped (not found): ${appDir}`);
      continue;
    }
    emit({ phase: "copying", dir: appDir });
    const n = await copyFiltered(
      root,
      dest,
      appDir,
      config.ignoreDirs,
      config.excludePathSegments,
      config.excludeExtensions,
    );
    appFiles += n;
    logger.log(`  copied ${n} files: ${appDir}`);
  }

  // 6. Copy packages with filtering
  logger.log("Copying packages...");
  let pkgFiles = 0;
  for (const pkgDir of packageDirs) {
    const src = path.join(root, pkgDir);
    const s = await stat(src).catch(() => null);
    if (!s?.isDirectory()) {
      logger.log(`  skipped (not found): ${pkgDir}`);
      continue;
    }
    emit({ phase: "copying", dir: pkgDir });
    const n = await copyFiltered(
      root,
      dest,
      pkgDir,
      config.ignoreDirs,
      config.excludePathSegments,
      config.excludeExtensions,
    );
    pkgFiles += n;
    logger.log(`  copied ${n} files: ${pkgDir}`);
  }

  // 7. Fix package tsconfig files
  logger.log("Fixing package tsconfig files...");
  await fixPackageTsconfigs(dest, packageDirs);

  // 8. Fix app tsconfig files
  logger.log("Fixing app tsconfig files...");
  const appTsconfigPaths = await findAppTsconfigs(dest, config.appDirs);
  await fixAppTsconfigs(dest, appTsconfigPaths);

  // 9. Run post-process rules
  if (config.postProcess && config.postProcess.length > 0) {
    logger.log("Running post-process rules...");
    const ctx: ExtractContext = { root, dest, config, packageDirs };
    await runPostProcess(ctx, config.postProcess, emit);
  }

  // 10. Regenerate tsconfig.base.json
  await regenerateTsconfigBase(dest, config);

  // 11. Sample batch data (if configured)
  if (config.batchDataDir) {
    logger.log("Sampling batch data...");
    const batchSrc = path.join(root, config.batchDataDir);
    const batchDest = path.join(dest, config.batchDataDir);
    if (
      await stat(batchSrc)
        .then((s) => s.isDirectory())
        .catch(() => false)
    ) {
      await copyBatchSample(batchSrc, batchDest, HTML_LIMIT);
    } else {
      logger.log("  batch data directory not found, skipping");
    }
  }

  // 12. Transform package.json files
  logger.log("Transforming package.json files...");
  const allDirs = [...config.appDirs, ...packageDirs];
  const pkgJsonFiles = await findPackageJsonFiles(dest, allDirs);
  for (const rel of pkgJsonFiles) {
    await transformPackageJson(dest, rel, config);
  }

  // 13. Generate lockfile
  logger.log(`Generating ${pm} lockfile...`);
  const installBin = pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npm";
  try {
    execFileSync(installBin, ["install"], { cwd: dest, stdio: "pipe" });
    logger.log(`  generated ${pm} lockfile`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`  ${pm} install FAILED — lockfile not generated`);
    logger.error(`  ${msg.slice(0, 500)}`);
    throw new PackageManagerError(
      `${pm} install`,
      msg.slice(0, 200),
      err instanceof Error ? err : undefined,
    );
  }

  // 14. Cleanup stray artifacts
  logger.log("Cleaning stray artifacts...");
  await cleanStrayArtifacts(dest);

  // 14b. Generate CI workflow
  logger.log("Generating CI workflow...");
  const ciDir = path.join(dest, ".github", "workflows");
  await mkdir(ciDir, { recursive: true });
  const ciContent = generateCiWorkflow(pm, config.ci);
  if (ciContent) {
    await writeFile(path.join(ciDir, "ci.yml"), ciContent);
    logger.log("  generated .github/workflows/ci.yml");
  } else {
    logger.log("  skipped CI workflow (provider: none)");
  }

  // 15. Summary
  logger.log("");
  logger.log("=== Export complete ===");
  logger.log(`  destination: ${dest}`);
  logger.log(`  apps files:  ${appFiles}`);
  logger.log(`  package files: ${pkgFiles}`);

  // 15b. Secret scan — abort before git commit if secrets found
  let secretsScanned = false;
  if (!config.skipSecretScan) {
    emit({ phase: "scanning", dest });
    logger.log("Scanning for secrets...");
    const findings = await scanForSecrets(dest);
    secretsScanned = true;
    if (findings.length > 0) {
      throw new SecretScanError(findings);
    }
    logger.log("  no secrets found");
  }

  // 16. Transfer git history (by path prefix)
  const historyPrefixes = [config.projectDir, ...packageDirs];
  emit({ phase: "gitHistory", prefixes: historyPrefixes });
  await transferGitHistory(root, dest, historyPrefixes);

  // 17. Git commit + push
  emit({ phase: "gitCommit", message: changelogCommitMessage });
  const gitResult = await commitExport(dest, changelogCommitMessage, config.git);
  if (gitResult.pushed) {
    emit({ phase: "gitPush", remote: config.git?.remote ?? "origin" });
  }

  const result: ExtractResult = {
    dest,
    mode: "monorepo",
    filesCopied: appFiles + pkgFiles,
    packagesCopied: packageDirs.length,
    gitCommitted: gitResult.committed,
    gitPushed: gitResult.pushed,
    changelogGenerated,
    secretsScanned,
  };
  emit({ phase: "complete", result });
  return result;
}

async function exportStandalonePackage(
  root: string,
  dest: string,
  config: ExtractConfig,
  logger: Logger,
  emit: (event: ExtractProgressEvent) => void,
): Promise<ExtractResult> {
  const pm: PackageManager = config.packageManager ?? detectPackageManager(root);
  const changelogCommitMessage = `chore(${config.destName}): export ${new Date().toISOString().slice(0, 10)}`;

  // 1. Clean destination
  emit({ phase: "cleaning", dest });
  logger.log("Cleaning destination...");
  await removeDest(dest);
  await ensureDir(dest);

  // 2. Copy package contents
  emit({ phase: "copying", dir: config.projectDir });
  logger.log("Copying standalone package...");
  const fileCount = await copyStandalonePackage(
    root,
    dest,
    config.projectDir,
    config.ignoreDirs,
    config.excludePathSegments,
    config.excludeExtensions,
  );
  logger.log(`  copied ${fileCount} files`);

  // 3. Rewrite tsconfig.json to be self-contained
  logger.log("Rewriting tsconfig.json (self-contained)...");
  const tsconfigPath = path.join(dest, "tsconfig.json");
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
      logger.log("  inlined base config, removed customConditions");
    } else {
      logger.log("  no extends to inline, skipping");
    }
  } catch {
    logger.log("  no tsconfig.json found, skipping");
  }

  // 4. Write .gitignore
  const gitignoreContent = buildGitignore(config.extraGitignore, config);
  await writeFile(path.join(dest, ".gitignore"), gitignoreContent);
  logger.log("  wrote .gitignore");

  // 4b. Fix standalone package.json (test script, workspace deps)
  logger.log("Fixing standalone package.json...");
  await fixStandalonePackageJson(dest, config, pm, root);

  // 4c. Fix vitest.config.ts (relative test paths)
  logger.log("Fixing vitest.config.ts...");
  await fixStandaloneVitestConfig(dest);

  // 5. Clean stray artifacts
  logger.log("Cleaning stray artifacts...");
  await cleanStrayArtifacts(dest);

  // 5b. Generate CI workflow
  logger.log("Generating CI workflow...");
  const ciDir = path.join(dest, ".github", "workflows");
  await mkdir(ciDir, { recursive: true });
  const ciContent = generateCiWorkflow(pm, config.ci);
  if (ciContent) {
    await writeFile(path.join(ciDir, "ci.yml"), ciContent);
    logger.log("  generated .github/workflows/ci.yml");
  } else {
    logger.log("  skipped CI workflow (provider: none)");
  }

  // 6. Summary
  logger.log("");
  logger.log("=== Export complete ===");
  logger.log(`  destination: ${dest}`);

  // 6b. Secret scan — abort before git commit if secrets found
  let secretsScanned = false;
  if (!config.skipSecretScan) {
    emit({ phase: "scanning", dest });
    logger.log("Scanning for secrets...");
    const findings = await scanForSecrets(dest);
    secretsScanned = true;
    if (findings.length > 0) {
      throw new SecretScanError(findings);
    }
    logger.log("  no secrets found");
  }

  // 7. Transfer git history (by path prefix)
  emit({ phase: "gitHistory", prefixes: [config.projectDir] });
  await transferGitHistory(root, dest, [config.projectDir]);

  // 8. Git commit + push
  emit({ phase: "gitCommit", message: changelogCommitMessage });
  const gitResult = await commitExport(dest, changelogCommitMessage, config.git);
  if (gitResult.pushed) {
    emit({ phase: "gitPush", remote: config.git?.remote ?? "origin" });
  }

  const result: ExtractResult = {
    dest,
    mode: "standalone",
    filesCopied: fileCount,
    packagesCopied: 0,
    gitCommitted: gitResult.committed,
    gitPushed: gitResult.pushed,
    changelogGenerated: false,
    secretsScanned,
  };
  emit({ phase: "complete", result });
  return result;
}
