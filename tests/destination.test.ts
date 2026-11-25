import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { extractProject } from "../src/extract.js";
import { ExtractConfigSchema } from "../src/config.js";

let sandbox: string;
let root: string;
let target: string;
const config = {
  projectDir: "packages/sample",
  destName: "sample",
  destBase: "packages",
  lockDestination: true,
  appDirs: [],
  packageManager: "pnpm" as const,
};

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "export-placement-"));
  root = path.join(sandbox, "source");
  target = path.join(sandbox, "packages/sample");
  mkdirSync(root);
  vi.spyOn(process, "cwd").mockReturnValue(root);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(sandbox, { recursive: true, force: true });
});

describe("locked destination preflight", () => {
  it("retains the option through schema parsing", () => {
    expect(ExtractConfigSchema.parse(config).lockDestination).toBe(true);
    expect(
      ExtractConfigSchema.parse({ ...config, lockDestination: undefined }).lockDestination,
    ).toBeUndefined();
  });
  it("plans the canonical destination without creating it", async () => {
    const result = await extractProject(config, { dryRun: true, fromHead: true });
    expect(result.dest).toBe(target);
    expect(existsSync(target)).toBe(false);
  });
  it.each([false, true])("rejects an override before mutation (dryRun=%s)", async (dryRun) => {
    const wrong = path.join(sandbox, "sample");
    mkdirSync(wrong);
    writeFileSync(path.join(wrong, "keep"), "untouched");
    const events: string[] = [];
    await expect(
      extractProject(config, {
        dest: wrong,
        dryRun,
        fromHead: true,
        onProgress: (event) => events.push(event.phase),
      }),
    ).rejects.toThrow(/locked/);
    expect(readFileSync(path.join(wrong, "keep"), "utf8")).toBe("untouched");
    expect(events).toEqual(["error"]);
    expect(existsSync(target)).toBe(false);
  });
  it("rejects a root duplicate even with the correct destination", async () => {
    mkdirSync(path.join(sandbox, "sample"));
    await expect(extractProject(config, { dryRun: true })).rejects.toThrow(/Misplaced export/);
  });
  it("rejects a dangling root duplicate symlink", async () => {
    symlinkSync(path.join(sandbox, "missing"), path.join(sandbox, "sample"));
    await expect(extractProject(config, { dryRun: true })).rejects.toThrow(/Misplaced export/);
  });
  it.each(["container", "destination"])("rejects a %s symlink", async (kind) => {
    if (kind === "destination") mkdirSync(path.dirname(target));
    symlinkSync(root, kind === "container" ? path.dirname(target) : target);
    await expect(extractProject(config, { dryRun: true })).rejects.toThrow(/real directory/);
  });
  it.each(["..", "../escape", "/absolute", "nested/name", "nested\\name"])(
    "rejects escaping destination name %s",
    async (destName) => {
      await expect(extractProject({ ...config, destName }, { dryRun: true })).rejects.toThrow(
        /single directory/,
      );
    },
  );
  it("rejects an escaping container", async () => {
    await expect(
      extractProject({ ...config, destBase: "../elsewhere" }, { dryRun: true }),
    ).rejects.toThrow(/single directory/);
  });
  it("preserves custom destinations for consumers without the lock", async () => {
    const dest = path.join(sandbox, "custom");
    const result = await extractProject(
      { ...config, lockDestination: false },
      { dest, dryRun: true, fromHead: true },
    );
    expect(result.dest).toBe(dest);
  });
});
