/*
<MODULE_CONTRACT>
<purpose>Public API exports for @warpgogol/repo-extract.</purpose>
<non-goals>
  <item>Does not implement CLI parsing (see cli.ts).</item>
  <item>Does not implement config loading (see config.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial scaffold for RFC-0070.</item>
</CHANGE_SUMMARY>
*/

export { loadConfig, ExtractConfigSchema } from "./config.js";
export { extractProject } from "./extract.js";
export { detectPackageManager } from "./package-manager.js";
export { scanForSecrets } from "./scan.js";
export { transferGitHistory, commitExport } from "./fs/git.js";
export {
  generateCiWorkflow,
  fixStandalonePackageJson,
  fixStandaloneVitestConfig,
} from "./fs/transform.js";
export type {
  ExtractConfig,
  ExtractContext,
  ExtractOptions,
  PackageManager,
  CiConfig,
  PostProcessRule,
  PostProcessAction,
  CopyRule,
  PatchRule,
  DeleteRule,
  GitConfig,
  SecretFinding,
} from "./types.js";
