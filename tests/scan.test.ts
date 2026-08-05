import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { scanForSecrets } from "../src/scan.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `repo-extract-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("scanForSecrets", () => {
  it("detects AWS Access Key ID", async () => {
    await writeFile(path.join(tmpDir, "config.ts"), 'const key = "AKIAIOSFODNN7EXAMPLE";');
    const findings = await scanForSecrets(tmpDir);
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe("AWS Access Key ID");
  });

  it("detects AWS STS Access Key ID", async () => {
    await writeFile(path.join(tmpDir, "data.md"), "See ASIA2F3EMEYERYVES5RP in the URL");
    const findings = await scanForSecrets(tmpDir);
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe("AWS STS Access Key ID");
  });

  it("detects pre-signed S3 URL with credentials", async () => {
    await writeFile(
      path.join(tmpDir, "notes.md"),
      "https://s3.amazonaws.com/file?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=abc123&x-amz-security-token=token123",
    );
    const findings = await scanForSecrets(tmpDir);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.name === "Pre-signed S3 URL with credentials")).toBe(true);
  });

  it("detects private key (PEM)", async () => {
    await writeFile(
      path.join(tmpDir, "key.pem"),
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
    );
    const findings = await scanForSecrets(tmpDir);
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe("Private key (PEM)");
  });

  it("detects GitHub token", async () => {
    await writeFile(
      path.join(tmpDir, "ci.yml"),
      "token: ghp_1234567890abcdefghijklmnopqrstuvwxyz1234",
    );
    const findings = await scanForSecrets(tmpDir);
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe("GitHub token");
  });

  it("returns empty for clean files", async () => {
    await writeFile(path.join(tmpDir, "README.md"), "# My Package\n\nThis is a clean file.\n");
    const findings = await scanForSecrets(tmpDir);
    expect(findings).toHaveLength(0);
  });

  it("skips .git directory", async () => {
    await mkdir(path.join(tmpDir, ".git"), { recursive: true });
    await writeFile(path.join(tmpDir, ".git", "config"), 'key = "AKIAIOSFODNN7EXAMPLE"');
    const findings = await scanForSecrets(tmpDir);
    expect(findings).toHaveLength(0);
  });

  it("skips files larger than 1 MB", async () => {
    const big = "x".repeat(1024 * 1024 + 1);
    await writeFile(path.join(tmpDir, "big.txt"), big + "\nAKIAIOSFODNN7EXAMPLE");
    const findings = await scanForSecrets(tmpDir);
    expect(findings).toHaveLength(0);
  });

  it("reports file path and line number", async () => {
    await mkdir(path.join(tmpDir, "src"), { recursive: true });
    await writeFile(
      path.join(tmpDir, "src", "config.ts"),
      'line 1\nline 2\nconst key = "AKIAIOSFODNN7EXAMPLE";\nline 4\n',
    );
    const findings = await scanForSecrets(tmpDir);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe(path.join("src", "config.ts"));
    expect(findings[0].line).toBe(3);
  });
});
