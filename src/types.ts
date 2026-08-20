/*
<MODULE_CONTRACT>
<purpose>Shared types for @warpgogol/repo-extract.</purpose>
<non-goals>
  <item>Does not define Zod schemas (see config.ts).</item>
  <item>Does not implement logic (see extract.ts, fs/*.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial types for RFC-0070: ExtractConfig, ExtractContext, PostProcessRule.</item>
  <item>RFC-0071: Added stripScopes, preservePackages, rootPackageName, customConditions, aiEcosystemFiles, monorepoConfigFiles, onlyBuiltDependencies, destBase, packageManager, gitignoreMode fields.</item>
  <item>RFC-0072: Changed packageManager from string to PackageManager enum. Added CiConfig interface and ci field.</item>
  <item>RFC-0074: Added ExtractResult, ExtractProgressEvent, ProgressCallback types. Added onProgress to ExtractOptions.</item>
  <item>RFC-0075: Added excludePathSegments and excludeExtensions fields for config-driven file exclusion.</item>
</CHANGE_SUMMARY>
*/

export type PackageManager = "pnpm" | "npm" | "yarn";

export type VersionBump = "patch" | "minor" | "major";

export interface CiConfig {
  provider: "github-actions" | "none";
  packageManager?: PackageManager;
  publish: boolean;
  nodeVersion: number;
}

export type PostProcessAction = "copy" | "patch" | "delete";

export interface CopyRule {
  action: "copy";
  from: string;
  to: string;
}

export interface PatchRule {
  action: "patch";
  file: string;
  find?: string;
  replace?: string;
  removeLinesMatching?: string;
}

export interface DeleteRule {
  action: "delete";
  path: string;
}

export type PostProcessRule = CopyRule | PatchRule | DeleteRule;

export interface GitConfig {
  remote?: string;
  autoPush?: boolean;
}

export interface ExtractConfig {
  projectDir: string;
  destName: string;
  appDirs: string[];
  packageDirs?: string[];
  projectRootFiles?: string[];
  extraGitignore?: string[];
  batchDataDir?: string;
  postProcess?: PostProcessRule[];
  workspacePrefixes?: string[];
  stripScopes?: string[];
  preservePackages?: string[];
  rootPackageName?: string;
  customConditions?: string[];
  aiEcosystemFiles?: string[];
  monorepoConfigFiles?: string[];
  onlyBuiltDependencies?: string[];
  destBase?: string;
  packageManager?: PackageManager;
  ci?: CiConfig;
  gitignoreMode?: "minimal" | "extended";
  git?: GitConfig;
  copyDirs?: string[];
  standalone?: boolean;
  ignoreDirs?: string[];
  excludePathSegments?: string[];
  excludeExtensions?: string[];
  skipSecretScan?: boolean;
  versionBump?: VersionBump;
  stubPackages?: string[];
}

export interface ExtractContext {
  root: string;
  dest: string;
  config: ExtractConfig;
  packageDirs: string[];
}

export interface ExtractOptions {
  dest?: string;
  dryRun?: boolean;
  verbose?: boolean;
  onProgress?: ProgressCallback;
}

export interface SecretFinding {
  file: string;
  line: number;
  name: string;
  preview: string;
}

export interface ExtractResult {
  dest: string;
  mode: "monorepo" | "standalone";
  filesCopied: number;
  packagesCopied: number;
  gitCommitted: boolean;
  gitPushed: boolean;
  changelogGenerated: boolean;
  secretsScanned: boolean;
}

export type ExtractProgressEvent =
  | { phase: "start"; config: ExtractConfig; dest: string }
  | { phase: "cleaning"; dest: string }
  | { phase: "copying"; dir: string; fileCount?: number }
  | { phase: "transforming"; file: string }
  | { phase: "postProcess"; rule: PostProcessRule }
  | { phase: "scanning"; dest: string }
  | { phase: "gitHistory"; prefixes: string[] }
  | { phase: "gitCommit"; message: string }
  | { phase: "gitPush"; remote: string }
  | { phase: "complete"; result: ExtractResult }
  | { phase: "error"; error: Error };

export type ProgressCallback = (event: ExtractProgressEvent) => void;
