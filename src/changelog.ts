/*
<MODULE_CONTRACT>
<purpose>Optional changelog-live integration via dynamic import.</purpose>
<non-goals>
  <item>Does not hard-depend on @warpgogol/changelog-live — it is an optional peer dependency.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial changelog integration for RFC-0070. Uses dynamic import to gracefully handle missing peer dep.</item>
  <item>RFC-0073: consolidated getLastExportDate — removed local duplicate, imports from fs/git.js.</item>
  <item>RFC-0075: removed dead tryAiCommitMessage() function and unused getLastExportDate import.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import * as path from "node:path";

export interface ChangelogResult {
  skipped: boolean;
  commitMessage?: string;
  sectionsGenerated: number;
  filesWritten: string[];
}

export async function tryGenerateChangelog(projectDir: string): Promise<ChangelogResult> {
  const changelogConfigPath = path.join(projectDir, "changelog.config.yaml");
  if (!existsSync(changelogConfigPath)) {
    return { skipped: true, sectionsGenerated: 0, filesWritten: [] };
  }

  try {
    const mod = await import("@warpgogol/changelog-live");
    const { loadConfig, generateChangelog } = mod;
    const config = await loadConfig(changelogConfigPath);
    config.git.repoRoot = path.resolve(projectDir, config.git.repoRoot);
    config.output.dir = path.resolve(projectDir, config.output.dir);
    const result = await generateChangelog(config);
    return {
      skipped: result.skipped,
      commitMessage: result.commitMessage,
      sectionsGenerated: result.sectionsGenerated,
      filesWritten: result.filesWritten,
    };
  } catch (err) {
    console.log("  changelog generation skipped (peer dep not installed or error)");
    console.log(`  ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    return { skipped: true, sectionsGenerated: 0, filesWritten: [] };
  }
}
