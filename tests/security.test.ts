import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as os from "node:os";
import { commitExport } from "../src/fs/git.js";

let tmpDest: string;

beforeEach(async () => {
  tmpDest = path.join(
    os.tmpdir(),
    `repo-extract-security-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDest, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDest, { recursive: true, force: true });
});

function gitInit(cwd: string): void {
  execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd, stdio: "pipe" });
}

function gitLog(cwd: string): string {
  return execFileSync("git", ["log", "--oneline"], { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

describe("security: shell injection prevention", () => {
  it("commit message with double quotes works correctly", async () => {
    gitInit(tmpDest);
    await writeFile(path.join(tmpDest, "file.txt"), "content\n");

    const msg = 'fix: handle "edge case" in parser';
    await commitExport(tmpDest, msg);

    const log = gitLog(tmpDest);
    expect(log).toContain('fix: handle "edge case" in parser');
  });

  it("commit message with $(whoami) does not execute command substitution", async () => {
    gitInit(tmpDest);
    await writeFile(path.join(tmpDest, "file.txt"), "content\n");

    const msg = "fix: resolve $(whoami) issue";
    await commitExport(tmpDest, msg);

    const log = gitLog(tmpDest);
    expect(log).toContain("$(whoami)");
    expect(log).not.toMatch(/\broot\b|\bsyrokomskyi\b/);
  });

  it("remote URL with shell metacharacters does not execute commands", async () => {
    gitInit(tmpDest);
    await writeFile(path.join(tmpDest, "file.txt"), "content\n");

    const maliciousRemote = "https://example.com/repo.git; echo pwned";
    await commitExport(tmpDest, "test commit", { remote: maliciousRemote, autoPush: false });

    const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: tmpDest,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    expect(remoteUrl).toBe(maliciousRemote);
  });
});
