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
</CHANGE_SUMMARY>
*/

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
  git?: GitConfig;
  copyDirs?: string[];
  standalone?: boolean;
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
}
