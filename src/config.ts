/*
<MODULE_CONTRACT>
<purpose>Zod schema and loader for extract.config.yaml files.</purpose>
<non-goals>
  <item>Does not implement extraction logic (see extract.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial config schema and loader for RFC-0070.</item>
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
    (v) => v.removeLinesMatching !== undefined || (v.find !== undefined && v.replace !== undefined),
    { message: "patch rule must have either (find + replace) or removeLinesMatching" },
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

const ExtractConfigSchema = z.object({
  projectDir: z.string().min(1),
  destName: z.string().min(1),
  appDirs: z.array(z.string()).default([]),
  packageDirs: z.array(z.string()).optional(),
  projectRootFiles: z.array(z.string()).optional(),
  extraGitignore: z.array(z.string()).optional(),
  batchDataDir: z.string().optional(),
  postProcess: z.array(PostProcessRuleSchema).optional(),
  workspacePrefixes: z.array(z.string()).default(["@syrokomskyi/", "@warpgogol/"]),
  git: GitConfigSchema.optional(),
  copyDirs: z.array(z.string()).optional(),
  standalone: z.boolean().default(false),
  ignoreDirs: z.array(z.string()).optional(),
  skipSecretScan: z.boolean().optional(),
});

export async function loadConfig(configPath: string): Promise<ExtractConfig> {
  const raw = await readFile(configPath, "utf-8");
  const parsed = parseYaml(raw);
  return ExtractConfigSchema.parse(parsed) as ExtractConfig;
}

export { ExtractConfigSchema };
