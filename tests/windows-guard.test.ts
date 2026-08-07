import { describe, it, expect } from "vitest";

describe("transferGitHistory Windows multi-prefix guard", () => {
  it("throws on Windows with multiple prefixes", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    try {
      const { transferGitHistory } = await import("../src/fs/git.js");

      const repoRoot = process.cwd();
      await expect(
        transferGitHistory(repoRoot, "/tmp/fake-dest-0075", ["packages/a", "packages/b"]),
      ).rejects.toThrow(/Multi-prefix git history transfer is not supported on Windows/);
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("does not throw on non-Windows with multiple prefixes (non-git source returns false)", async () => {
    const { transferGitHistory } = await import("../src/fs/git.js");

    await expect(
      transferGitHistory("/fake/root", "/fake/dest", ["packages/a", "packages/b"]),
    ).resolves.toBe(false);
  });
});
