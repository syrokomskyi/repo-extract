/*
<MODULE_CONTRACT>
<purpose>Secret scanner — scans exported files for known secret patterns before git commit.</purpose>
<non-goals>
  <item>Does not modify or redact files — only reports findings and aborts export.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial secret scanner: AWS keys, private keys, generic tokens, pre-signed S3 URLs.</item>
  <item>RFC-0075: removed duplicate SecretFinding interface (import from types.ts). Consolidated inline import to top-level.</item>
</CHANGE_SUMMARY>
*/

import { readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import type { SecretFinding } from "./types.js";
import type { Logger } from "./log.js";

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "AWS Access Key ID", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "AWS STS Access Key ID", pattern: /ASIA[0-9A-Z]{16}/g },
  { name: "AWS Secret Access Key", pattern: /aws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{40}/gi },
  {
    name: "Pre-signed S3 URL with credentials",
    pattern: /AWSAccessKeyId=[A-Z0-9]+&Signature=[^&]+&x-amz-security-token=/gi,
  },
  {
    name: "Private key (PEM)",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  },
  { name: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9]{36}/g },
  {
    name: "Generic API key assignment",
    pattern: /(?:api[_-]?key|apikey|secret[_-]?key)\s*[=:]\s*['"][A-Za-z0-9]{32,}['"]/gi,
  },
];

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB — skip larger files

export async function scanForSecrets(dest: string, logger?: Logger): Promise<SecretFinding[]> {
  const log = logger?.log ?? console.log;
  const findings: SecretFinding[] = [];
  await scanDir(dest, dest, findings, log);
  return findings;
}

async function scanDir(
  root: string,
  dir: string,
  findings: SecretFinding[],
  log: (msg: string) => void,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanDir(root, fullPath, findings, log);
    } else if (entry.isFile()) {
      await scanFile(root, fullPath, findings);
    }
  }
}

async function scanFile(root: string, filePath: string, findings: SecretFinding[]): Promise<void> {
  const s = await stat(filePath).catch(() => null);
  if (!s || s.size > MAX_FILE_SIZE) return;

  const content = await readFile(filePath, "utf-8").catch(() => null);
  if (!content) return;

  const relPath = path.relative(root, filePath);
  const lines = content.split("\n");

  for (const { name, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split("\n").length;
      const line = lines[lineNum - 1] ?? "";
      const preview = line.length > 120 ? line.slice(0, 120) + "..." : line;
      findings.push({
        file: relPath,
        line: lineNum,
        name,
        preview: preview.trim(),
      });
    }
  }
}
