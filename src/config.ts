/*
<MODULE_CONTRACT>
<purpose>Zod schema and loader for extract.config.yaml files.</purpose>
<non-goals>
  <item>Does not implement extraction logic (see extract.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial config schema and loader for RFC-0070.</item>
  <item>RFC-0071: Added stripScopes, preservePackages, rootPackageName, customConditions, aiEcosystemFiles, monorepoConfigFiles, onlyBuiltDependencies, destBase, packageManager, gitignoreMode. Changed workspacePrefixes default to [] and copyDirs default to [].</item>
  <item>RFC-0072: Changed packageManager from string to enum. Added CiConfigSchema and ci field.</item>
  <item>RFC-0075: Added excludePathSegments and excludeExtensions fields.</item>
  <item>ADR-0016: Config schema is the single source of truth — all org-specific values are config fields with org-neutral defaults, no behavioral assumptions baked into source code.</item>
</CHANGE_SUMMARY>
*/

import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { ExtractConfig } from "./types.js";

const GitConfigSchema = z.object({
  remote: z.string().optional(),
  autoPush: z.boolean().optional(),
});

const CopyRuleSchema = z.object({
  action: z.literal("copy"),
  from: z.string(),
  to: z.string(),
});

const PatchRuleSchema = z
  .object({
    action: z.literal("patch"),
    file: z.string(),
    find: z.string().optional(),
    replace: z.string().optional(),
    removeLinesMatching: z.string().optional(),
  })
  .refine(
    (v) =>
      v.removeLinesMatching !== undefined ||
      (v.find !== undefined && v.replace !== undefined),
    {
      message:
        "patch rule must have either (find + replace) or removeLinesMatching",
    },
  );

const DeleteRuleSchema = z.object({
  action: z.literal("delete"),
  path: z.string(),
});

const PostProcessRuleSchema = z.discriminatedUnion("action", [
  CopyRuleSchema,
  PatchRuleSchema,
  DeleteRuleSchema,
]);

const CiConfigSchema = z.object({
  provider: z.enum(["github-actions", "none"]).default("github-actions"),
  packageManager: z.enum(["pnpm", "npm", "yarn"]).optional(),
  publish: z.boolean().default(true),
  nodeVersion: z.number().default(22),
});

const ExtractConfigSchema = z.object({
  projectDir: z.string().min(1),
  destName: z.string().min(1),
  appDirs: z.array(z.string()).default([]),
  packageDirs: z.array(z.string()).optional(),
  projectRootFiles: z.array(z.string()).optional(),
  extraGitignore: z.array(z.string()).optional(),
  batchDataDir: z.string().optional(),
  postProcess: z.array(PostProcessRuleSchema).optional(),
  workspacePrefixes: z.array(z.string()).default([]),
  stripScopes: z.array(z.string()).optional(),
  preservePackages: z.array(z.string()).default([]),
  rootPackageName: z.string().optional(),
  customConditions: z.array(z.string()).default([]),
  aiEcosystemFiles: z.array(z.string()).default([]),
  monorepoConfigFiles: z.array(z.string()).optional(),
  onlyBuiltDependencies: z.array(z.string()).default([]),
  destBase: z.string().optional(),
  packageManager: z.enum(["pnpm", "npm", "yarn"]).optional(),
  ci: CiConfigSchema.optional(),
  gitignoreMode: z.enum(["minimal", "extended"]).default("extended"),
  git: GitConfigSchema.optional(),
  copyDirs: z.array(z.string()).default([]),
  standalone: z.boolean().default(false),
  ignoreDirs: z.array(z.string()).optional(),
  excludePathSegments: z.array(z.string()).optional(),
  excludeExtensions: z.array(z.string()).optional(),
  skipSecretScan: z.boolean().optional(),
  versionBump: z.enum(["patch", "minor", "major"]).optional(),
  stubPackages: z.array(z.string()).default([]),
});

export async function loadConfig(configPath: string): Promise<ExtractConfig> {
  const raw = await readFile(configPath, "utf-8");
  const parsed = parseYaml(raw);
  const config = ExtractConfigSchema.parse(parsed) as ExtractConfig;
  if (config.stripScopes === undefined) {
    config.stripScopes = config.workspacePrefixes;
  }
  return config;
}

export { ExtractConfigSchema };
