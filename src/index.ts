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
export type {
  ExtractConfig,
  ExtractContext,
  ExtractOptions,
  PostProcessRule,
  PostProcessAction,
  CopyRule,
  PatchRule,
  DeleteRule,
  GitConfig,
} from "./types.js";
