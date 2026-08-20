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
  <item>Fix: Added lockfile generation to exportStandalonePackage — standalone packages need lockfiles for --frozen-lockfile in CI.</item>
</CHANGE_SUMMARY>
*/

import {
  stat,
  cp,
  mkdir,
  writeFile,
  readFile,
  readdir,
} from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
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
  bumpSourceVersion,
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
    config.destBase ??
    (config.projectDir.startsWith("packages/") ? "packages" : "exports");
  const dest =
    options.dest ?? path.resolve(root, "..", destBase, config.destName);
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
    logger.log(
      `  stubPackages: ${config.stubPackages?.join(", ") || "(none)"}`,
    );
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
    emit({
      phase: "error",
      error: err instanceof Error ? err : new Error(String(err)),
    });
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
  const pm: PackageManager =
    config.packageManager ?? detectPackageManager(root, logger);
  const projectDir = path.join(root, config.projectDir);

  // 0. Bump source version before copy
  if (config.versionBump) {
    logger.log("Bumping source version...");
    await bumpSourceVersion(root, config, logger);
  }

  // 0b. Generate changelog
  let changelogCommitMessage = `chore(${config.destName}): export ${new Date().toISOString().slice(0, 10)}`;
  const changelogResult = await tryGenerateChangelog(projectDir, logger);
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
  const monorepoFiles =
    config.monorepoConfigFiles ?? getMonorepoConfigFiles(pm);
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
    packageDirs = await discoverPackageDeps(
      root,
      config.appDirs,
      config.workspacePrefixes,
    );
    logger.log(
      `  found ${packageDirs.length} packages: ${packageDirs.join(", ")}`,
    );
  }

  await generateRootFiles(
    dest,
    root,
    config,
    packageDirs,
    config.appDirs,
    pm,
    logger,
  );

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
    await runPostProcess(ctx, config.postProcess, emit, logger);
  }

  // 10. Regenerate tsconfig.base.json
  await regenerateTsconfigBase(dest, config, logger);

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
      await copyBatchSample(batchSrc, batchDest, HTML_LIMIT, logger);
    } else {
      logger.log("  batch data directory not found, skipping");
    }
  }

  // 12. Transform package.json files
  logger.log("Transforming package.json files...");
  const allDirs = [...config.appDirs, ...packageDirs];
  const pkgJsonFiles = await findPackageJsonFiles(dest, allDirs);
  for (const rel of pkgJsonFiles) {
    await transformPackageJson(dest, rel, config, logger);
  }

  // 13. Generate lockfile
  logger.log(`Generating ${pm} lockfile...`);
  const installBin = pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npm";
  const installArgs =
    pm === "pnpm"
      ? ["install", "--config.dangerouslyAllowAllBuilds=true"]
      : ["install"];
  try {
    execFileSync(installBin, installArgs, { cwd: dest, stdio: "pipe" });
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
    const findings = await scanForSecrets(dest, logger);
    secretsScanned = true;
    if (findings.length > 0) {
      throw new SecretScanError(findings);
    }
    logger.log("  no secrets found");
  }

  // 16. Transfer git history (by path prefix)
  const historyPrefixes = [config.projectDir, ...packageDirs];
  emit({ phase: "gitHistory", prefixes: historyPrefixes });
  await transferGitHistory(root, dest, historyPrefixes, logger);

  // 17. Git commit + push
  emit({ phase: "gitCommit", message: changelogCommitMessage });
  const gitResult = await commitExport(
    dest,
    changelogCommitMessage,
    config.git,
    logger,
  );
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
  const pm: PackageManager =
    config.packageManager ?? detectPackageManager(root, logger);
  const changelogCommitMessage = `chore(${config.destName}): export ${new Date().toISOString().slice(0, 10)}`;

  // 0. Bump source version before copy
  if (config.versionBump) {
    logger.log("Bumping source version...");
    await bumpSourceVersion(root, config, logger);
  }

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
      const srcTsconfigPath = path.join(
        root,
        config.projectDir,
        "tsconfig.json",
      );
      const srcTsconfig = JSON.parse(readFileSync(srcTsconfigPath, "utf-8"));
      const basePath = path.resolve(
        path.dirname(srcTsconfigPath),
        srcTsconfig.extends,
      );
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
  await fixStandalonePackageJson(dest, config, pm, root, logger);

  // 4c. Fix vitest.config.ts (relative test paths)
  logger.log("Fixing vitest.config.ts...");
  await fixStandaloneVitestConfig(dest, logger);

  // 4c-b. Generate stub shims for unresolvable workspace packages
  if (config.stubPackages && config.stubPackages.length > 0) {
    logger.log("Generating stub shims...");
    await generateStubShims(root, dest, config, logger);
  }

  // 4d. Generate lockfile
  logger.log(`Generating ${pm} lockfile...`);
  const installBin = pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npm";
  const installArgs =
    pm === "pnpm"
      ? ["install", "--config.dangerouslyAllowAllBuilds=true"]
      : ["install"];
  try {
    execFileSync(installBin, installArgs, { cwd: dest, stdio: "pipe" });
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

  // 4e. Clean up auto-generated pnpm-workspace.yaml (resolve interactive prompts)
  if (pm === "pnpm") {
    const wsPath = path.join(dest, "pnpm-workspace.yaml");
    try {
      const wsContent = await readFile(wsPath, "utf-8");
      const cleaned = wsContent.replace(/set this to true or false/g, "true");
      await writeFile(wsPath, cleaned);
      logger.log(
        "  cleaned pnpm-workspace.yaml (resolved allowBuilds prompts)",
      );
    } catch {
      /* no pnpm-workspace.yaml, no-op */
    }
  }

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
    const findings = await scanForSecrets(dest, logger);
    secretsScanned = true;
    if (findings.length > 0) {
      throw new SecretScanError(findings);
    }
    logger.log("  no secrets found");
  }

  // 7. Transfer git history (by path prefix)
  emit({ phase: "gitHistory", prefixes: [config.projectDir] });
  await transferGitHistory(root, dest, [config.projectDir], logger);

  // 8. Git commit + push
  emit({ phase: "gitCommit", message: changelogCommitMessage });
  const gitResult = await commitExport(
    dest,
    changelogCommitMessage,
    config.git,
    logger,
  );
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

interface NamedExport {
  kind: "function" | "const" | "class" | "interface" | "type" | "enum";
  name: string;
}

async function generateStubShims(
  root: string,
  dest: string,
  config: ExtractConfig,
  logger: Logger,
): Promise<void> {
  if (!config.stubPackages || config.stubPackages.length === 0) return;

  const shimDir = path.join(dest, "src", "types");
  await mkdir(shimDir, { recursive: true });

  for (const pkgName of config.stubPackages) {
    const pkgDir = await findPackageDir(root, pkgName);
    if (!pkgDir) {
      logger.log(`  skipped ${pkgName} (not found in monorepo)`);
      continue;
    }

    const pkgJsonPath = path.join(pkgDir, "package.json");
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    const exports = pkgJson.exports ?? {};
    const shortName = pkgName.split("/").pop() ?? pkgName;
    const shimFileName = `${shortName}-shims.d.ts`;
    const shimPath = path.join(shimDir, shimFileName);

    const lines: string[] = [
      `// Auto-generated type shims for ${pkgName}.`,
      `// Generated by repo-extract from source exports. Do not edit manually.`,
      ``,
    ];

    const seenModules = new Set<string>();

    for (const [exportKey, exportValue] of Object.entries(exports) as [
      string,
      unknown,
    ][]) {
      if (exportKey === "./package.json") continue;

      const modulePath =
        exportKey === "." ? pkgName : `${pkgName}${exportKey.slice(1)}`;

      if (seenModules.has(modulePath)) continue;
      seenModules.add(modulePath);

      const sourceFile = resolveSourceFile(pkgDir, exportValue);
      const namedExports = sourceFile
        ? parseNamedExportsRecursive(sourceFile, 0)
        : [];

      lines.push(`declare module "${modulePath}" {`);

      if (namedExports.length === 0) {
        lines.push(`  const _: any;`);
        lines.push(`  export = _;`);
      } else {
        const seen = new Set<string>();
        for (const exp of namedExports) {
          if (seen.has(exp.name)) continue;
          seen.add(exp.name);

          const isReserved = [
            "default",
            "break",
            "case",
            "catch",
            "class",
            "const",
            "continue",
            "debugger",
            "delete",
            "do",
            "else",
            "enum",
            "export",
            "extends",
            "false",
            "finally",
            "for",
            "function",
            "if",
            "import",
            "in",
            "instanceof",
            "new",
            "null",
            "return",
            "super",
            "switch",
            "this",
            "throw",
            "true",
            "try",
            "typeof",
            "var",
            "void",
            "while",
            "with",
          ].includes(exp.name);
          const safeName = isReserved ? `"${exp.name}"` : exp.name;
          if (exp.kind === "function") {
            lines.push(`  export function ${safeName}(...args: any[]): any;`);
          } else if (exp.kind === "const") {
            lines.push(`  export const ${safeName}: any;`);
          } else if (exp.kind === "class") {
            lines.push(
              `  export class ${safeName} { constructor(...args: any[]); }`,
            );
          } else if (exp.kind === "interface") {
            lines.push(`  export interface ${safeName} {}`);
          } else if (exp.kind === "type") {
            lines.push(`  export type ${safeName} = any;`);
          } else if (exp.kind === "enum") {
            lines.push(`  export enum ${safeName} {}`);
          }
        }
      }

      lines.push(`}`);
      lines.push(``);
    }

    await writeFile(shimPath, lines.join("\n"));
    logger.log(`  generated ${shimFileName} (${seenModules.size} modules)`);
  }
}

async function findPackageDir(
  root: string,
  pkgName: string,
): Promise<string | null> {
  const packagesDir = path.join(root, "packages");
  try {
    const entries = await readdir(packagesDir);
    for (const entry of entries) {
      const pkgJsonPath = path.join(packagesDir, entry, "package.json");
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        if (pkgJson.name === pkgName) {
          return path.join(packagesDir, entry);
        }
      } catch {
        // not a package, skip
      }
    }
  } catch {
    // no packages dir, skip
  }
  return null;
}

function resolveSourceFile(
  pkgDir: string,
  exportValue: unknown,
): string | null {
  let resolvedPath: string | undefined;

  if (typeof exportValue === "string") {
    resolvedPath = exportValue;
  } else if (typeof exportValue === "object" && exportValue !== null) {
    const obj = exportValue as Record<string, unknown>;
    if (typeof obj.types === "string") {
      resolvedPath = obj.types;
    } else if (typeof obj.default === "string") {
      resolvedPath = obj.default;
    } else {
      for (const v of Object.values(obj)) {
        if (typeof v === "string") {
          resolvedPath = v;
          break;
        } else if (typeof v === "object" && v !== null) {
          const inner = v as Record<string, unknown>;
          if (typeof inner.types === "string") {
            resolvedPath = inner.types;
            break;
          } else if (typeof inner.default === "string") {
            resolvedPath = inner.default;
            break;
          }
        }
      }
    }
  }

  if (!resolvedPath) return null;

  const fullPath = path.resolve(pkgDir, resolvedPath);
  if (existsSync(fullPath) && fullPath.endsWith(".ts")) {
    return fullPath;
  }
  return null;
}

function parseNamedExportsRecursive(
  filePath: string,
  depth: number,
): NamedExport[] {
  if (depth > 2) return [];

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  let exports = parseNamedExports(content);

  const wildcardRegex = /export\s+\*\s+from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = wildcardRegex.exec(content)) !== null) {
    const targetPath = resolveImportPath(filePath, match[1]);
    if (targetPath) {
      exports = exports.concat(
        parseNamedExportsRecursive(targetPath, depth + 1),
      );
    }
  }

  const reExportRegex = /export\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    const names = match[1]
      .split(",")
      .map((s) =>
        s
          .trim()
          .split(/\s+as\s+/)[0]
          .trim()
          .replace(/^type\s+/, ""),
      )
      .filter(Boolean);
    for (const name of names) {
      exports.push({ kind: "const", name });
    }
  }

  return exports;
}

function parseNamedExports(content: string): NamedExport[] {
  const exports: NamedExport[] = [];
  let match: RegExpExecArray | null;

  const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)/g;
  while ((match = funcRegex.exec(content)) !== null) {
    exports.push({ kind: "function", name: match[1] });
  }

  const constRegex = /export\s+const\s+(\w+)/g;
  while ((match = constRegex.exec(content)) !== null) {
    exports.push({ kind: "const", name: match[1] });
  }

  const letRegex = /export\s+let\s+(\w+)/g;
  while ((match = letRegex.exec(content)) !== null) {
    exports.push({ kind: "const", name: match[1] });
  }

  const classRegex = /export\s+class\s+(\w+)/g;
  while ((match = classRegex.exec(content)) !== null) {
    exports.push({ kind: "class", name: match[1] });
  }

  const interfaceRegex = /export\s+interface\s+(\w+)/g;
  while ((match = interfaceRegex.exec(content)) !== null) {
    exports.push({ kind: "interface", name: match[1] });
  }

  const typeRegex = /export\s+type\s+(\w+)/g;
  while ((match = typeRegex.exec(content)) !== null) {
    exports.push({ kind: "type", name: match[1] });
  }

  const enumRegex = /export\s+enum\s+(\w+)/g;
  while ((match = enumRegex.exec(content)) !== null) {
    exports.push({ kind: "enum", name: match[1] });
  }

  const namedRegex = /export\s*\{([^}]+)\}(?!\s*from)/g;
  while ((match = namedRegex.exec(content)) !== null) {
    const names = match[1]
      .split(",")
      .map((s) =>
        s
          .trim()
          .split(/\s+as\s+/)[0]
          .trim()
          .replace(/^type\s+/, ""),
      )
      .filter(Boolean);
    for (const name of names) {
      exports.push({ kind: "const", name });
    }
  }

  return exports;
}

function resolveImportPath(
  fromFile: string,
  importPath: string,
): string | null {
  if (!importPath.startsWith(".")) return null;

  const dir = path.dirname(fromFile);
  const candidates = [
    path.resolve(dir, importPath),
    path.resolve(dir, importPath + ".ts"),
    path.resolve(dir, importPath + "/index.ts"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
