import { describe, it, expect } from "vitest";
import { SecretScanError, GitOperationError, PackageManagerError } from "../src/errors.js";
import type { SecretFinding } from "../src/types.js";

describe("SecretScanError", () => {
  it("has findings property", () => {
    const findings: SecretFinding[] = [
      { file: "src/config.ts", line: 10, name: "API_KEY", preview: "sk-abc..." },
    ];
    const err = new SecretScanError(findings);
    expect(err.name).toBe("SecretScanError");
    expect(err.findings).toBe(findings);
    expect(err.message).toContain("1 secret(s)");
    expect(err.findings.length).toBe(1);
    expect(err.findings[0].name).toBe("API_KEY");
  });

  it("has multiple findings", () => {
    const findings: SecretFinding[] = [
      { file: "a.ts", line: 1, name: "KEY1", preview: "..." },
      { file: "b.ts", line: 2, name: "KEY2", preview: "..." },
    ];
    const err = new SecretScanError(findings);
    expect(err.findings.length).toBe(2);
    expect(err.message).toContain("2 secret(s)");
  });
});

describe("GitOperationError", () => {
  it("has operation and cause properties", () => {
    const cause = new Error("exit code 1");
    const err = new GitOperationError("commit", "failed to commit", cause);
    expect(err.name).toBe("GitOperationError");
    expect(err.operation).toBe("commit");
    expect(err.cause).toBe(cause);
    expect(err.message).toContain("commit");
    expect(err.message).toContain("failed to commit");
  });

  it("works without cause", () => {
    const err = new GitOperationError("push", "rejected");
    expect(err.operation).toBe("push");
    expect(err.cause).toBeUndefined();
  });
});

describe("PackageManagerError", () => {
  it("has command and cause properties", () => {
    const cause = new Error("ELIFECYCLE");
    const err = new PackageManagerError("pnpm install", "exit code 1", cause);
    expect(err.name).toBe("PackageManagerError");
    expect(err.command).toBe("pnpm install");
    expect(err.cause).toBe(cause);
    expect(err.message).toContain("pnpm install");
  });

  it("works without cause", () => {
    const err = new PackageManagerError("npm install", "network error");
    expect(err.command).toBe("npm install");
    expect(err.cause).toBeUndefined();
  });
});
