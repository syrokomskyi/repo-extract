/*
<MODULE_CONTRACT>
<purpose>Declarative post-process rule executor (copy, patch, delete).</purpose>
<non-goals>
  <item>Does not support variable interpolation or JS hooks.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial post-process rule runner for RFC-0070.</item>
  <item>RFC-0074: Added optional onProgress callback for per-rule progress events.</item>
</CHANGE_SUMMARY>
*/

import { readFile, writeFile, rm, cp, mkdir } from "node:fs/promises";
import * as path from "node:path";
import type { PostProcessRule, ExtractContext, ProgressCallback } from "../types.js";

export async function runPostProcess(
  ctx: ExtractContext,
  rules: PostProcessRule[],
  onProgress?: ProgressCallback,
): Promise<void> {
  for (const rule of rules) {
    try {
      onProgress?.({ phase: "postProcess", rule });
    } catch {
      // callback errors are non-fatal
    }
    switch (rule.action) {
      case "copy":
        await runCopy(ctx, rule);
        break;
      case "patch":
        await runPatch(ctx, rule);
        break;
      case "delete":
        await runDelete(ctx, rule);
        break;
    }
  }
}

async function runCopy(ctx: ExtractContext, rule: { from: string; to: string }): Promise<void> {
  const src = path.join(ctx.root, rule.from);
  const dest = path.join(ctx.dest, rule.to);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest);
  console.log(`  postProcess copy: ${rule.from} → ${rule.to}`);
}

async function runPatch(
  ctx: ExtractContext,
  rule: { file: string; find?: string; replace?: string; removeLinesMatching?: string },
): Promise<void> {
  const fullPath = path.join(ctx.dest, rule.file);
  let content: string;
  try {
    content = await readFile(fullPath, "utf-8");
  } catch {
    console.log(`  postProcess patch: skipped (not found: ${rule.file})`);
    return;
  }

  if (rule.removeLinesMatching !== undefined) {
    const lines = content.split("\n");
    const filtered = lines.filter((l) => !l.includes(rule.removeLinesMatching!));
    content = filtered.join("\n");
    console.log(
      `  postProcess patch: removed lines matching "${rule.removeLinesMatching}" from ${rule.file}`,
    );
  } else if (rule.find !== undefined && rule.replace !== undefined) {
    content = content.replaceAll(rule.find, rule.replace);
    console.log(`  postProcess patch: replaced "${rule.find}" → "${rule.replace}" in ${rule.file}`);
  }

  await writeFile(fullPath, content, "utf-8");
}

async function runDelete(ctx: ExtractContext, rule: { path: string }): Promise<void> {
  const fullPath = path.join(ctx.dest, rule.path);
  await rm(fullPath, { recursive: true, force: true });
  console.log(`  postProcess delete: ${rule.path}`);
}
