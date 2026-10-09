/*
<MODULE_CONTRACT>
<purpose>Shared types for @warpgogol/repo-extract. for reliable use by its direct callers and maintainers.</purpose>
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
  <item>RFC-0131: Added source/allowDirty config fields, git.autoReconcile, and ExtractOptions fromHead/ref/allowDirty/noPush for clean-source extraction and push reconciliation.</item>
</CHANGE_SUMMARY>
*/

export type PackageManager = "pnpm" | "npm" | "yarn";

export type VersionBump = "patch" | "minor" | "major";

export interface CloudflarePagesDeploy {
  provider: "cloudflare-pages";
  projectName: string;
  buildCommand: string;
  outputDir: string;
  apiTokenSecret: string;
  accountIdSecret?: string;
}

export type DeployConfig = CloudflarePagesDeploy;

export interface CiConfig {
  provider: "github-actions" | "none";
  packageManager?: PackageManager;
  publish: boolean;
  nodeVersion: number;
  deploy?: DeployConfig;
  workspaceFilter?: string;
  skipBuild?: boolean;
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
  /**
   * Transfer filtered monorepo git history into the destination repo.
   * Default: true. Set false to keep the destination's existing history
   * and commit plain snapshots — skips the full clone + filter-branch
   * rewrite, which dominates export time on large monorepos.
   */
  history?: boolean;
  /**
   * RFC-0131: on a non-fast-forward push rejection, reconcile automatically:
   * fetch origin, `merge -s ours origin/<branch>` (local tree is the
   * authoritative export), retry push once. Never force-pushes. Default: off.
   */
  autoReconcile?: boolean;
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
  /**
   * RFC-0131: where the export sources its files from.
   * "worktree" (default) — the working tree of the current checkout.
   * "head" — a temporary git worktree materialized at HEAD.
   */
  source?: "worktree" | "head";
  /**
   * RFC-0131: allow exporting with uncommitted changes under the exported
   * dirs. Default off — the dirty preflight aborts instead.
   */
  allowDirty?: boolean;
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
  /** RFC-0131: export HEAD via a temporary worktree instead of the working tree. */
  fromHead?: boolean;
  /** RFC-0131: export this ref instead of HEAD; implies fromHead. */
  ref?: string;
  /** RFC-0131: permit exporting with uncommitted changes (overrides dirty preflight). */
  allowDirty?: boolean;
  /** RFC-0131: commit the export locally without pushing (overrides git.autoPush). */
  noPush?: boolean;
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
  | { phase: "gitHistory"; pathPrefixes: string[] }
  | { phase: "gitCommit"; message: string }
  | { phase: "gitPush"; remote: string }
  | { phase: "complete"; result: ExtractResult }
  | { phase: "error"; error: Error };

export type ProgressCallback = (event: ExtractProgressEvent) => void;
