/*
<MODULE_CONTRACT>
<purpose>Optional changelog-live integration via dynamic import.</purpose>
<non-goals>
  <item>Does not hard-depend on @warpgogol/changelog-live — it is an optional peer dependency.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial changelog integration for RFC-0070. Uses dynamic import to gracefully handle missing peer dep.</item>
</CHANGE_SUMMARY>
*/

import { execSync } from "node:child_process";
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

export async function tryAiCommitMessage(dest: string, projectDir: string): Promise<string | null> {
  const changelogConfigPath = path.join(projectDir, "changelog.config.yaml");
  if (!existsSync(changelogConfigPath)) return null;

  try {
    const mod = await import("@warpgogol/changelog-live");
    const { loadConfig, getApiKey, collectCommits, PROVIDER_DEFAULT_MODELS } = mod;
    const config = await loadConfig(changelogConfigPath);

    const provider = config.ai.generation.provider;
    const model = config.ai.generation.model ?? PROVIDER_DEFAULT_MODELS[provider];
    const language = config.languages.primary;
    const apiKey = getApiKey(provider);

    const lastExportDate = getLastExportDate(dest);
    if (!lastExportDate) return null;

    const monorepoPaths = config.git.paths ?? (config.git.subPath ? [config.git.subPath] : []);
    const commits = collectCommits(
      path.resolve(projectDir, "../.."),
      monorepoPaths,
      lastExportDate,
    );
    if (commits.length === 0) return null;

    const userPrompt = commits
      .map(
        (c: { hash: string; date: string; message: string; files: { path: string }[] }) =>
          `commit ${c.hash} (${c.date})\n  ${c.message}`,
      )
      .join("\n\n");

    const systemPrompt = `You are a senior developer writing a concise git commit message. Write in ${language}. Max 72 characters. Imperative mood. Respond with ONLY the commit message text.`;

    if (provider === "openai") {
      // @ts-expect-error — optional runtime dep, not installed in this package
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 100,
        temperature: 0.3,
      });
      return response.choices[0]?.message?.content?.trim() ?? null;
    }

    if (provider === "anthropic") {
      // @ts-expect-error — optional runtime dep, not installed in this package
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model,
        max_tokens: 100,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      const textBlock = response.content.find((b: { type: string }) => b.type === "text");
      return textBlock?.text?.trim() ?? null;
    }

    if (provider === "gemini") {
      // @ts-expect-error — optional runtime dep, not installed in this package
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(apiKey);
      const genModel = genAI.getGenerativeModel({
        model,
        systemInstruction: systemPrompt,
        generationConfig: { temperature: 0.3, maxOutputTokens: 100 },
      });
      const result = await genModel.generateContent(userPrompt);
      return result.response.text().trim() || null;
    }

    return null;
  } catch {
    return null;
  }
}

function getLastExportDate(dest: string): string | null {
  try {
    const dateStr = execSync("git log -1 --format=%ad --date=format:%Y-%m-%d", {
      cwd: dest,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return dateStr || null;
  } catch {
    return null;
  }
}
