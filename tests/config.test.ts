import { describe, it, expect } from "vitest";
import { ExtractConfigSchema } from "../src/config.js";

describe("ExtractConfigSchema", () => {
  it("parses a valid monorepo config", () => {
    const config = {
      projectDir: "apps/hdri",
      destName: "hdri",
      appDirs: ["apps/hdri/factory", "apps/hdri/dashboard"],
    };
    const result = ExtractConfigSchema.parse(config);
    expect(result.projectDir).toBe("apps/hdri");
    expect(result.destName).toBe("hdri");
    expect(result.appDirs).toEqual(["apps/hdri/factory", "apps/hdri/dashboard"]);
    expect(result.standalone).toBe(false);
    expect(result.workspacePrefixes).toEqual(["@syrokomskyi/", "@warpgogol/"]);
  });

  it("parses a valid standalone config", () => {
    const config = {
      projectDir: "packages/changelog-live",
      destName: "changelog-live",
      appDirs: [],
      standalone: true,
    };
    const result = ExtractConfigSchema.parse(config);
    expect(result.standalone).toBe(true);
  });

  it("parses postProcess rules", () => {
    const config = {
      projectDir: "apps/hdri",
      destName: "hdri",
      appDirs: [],
      postProcess: [
        { action: "copy", from: "src.yaml", to: "dest.yaml" },
        { action: "patch", file: "ts.ts", find: "old", replace: "new" },
        { action: "patch", file: "ignore.txt", removeLinesMatching: "DEBUG" },
        { action: "delete", path: "old-dir" },
      ],
    };
    const result = ExtractConfigSchema.parse(config);
    expect(result.postProcess).toHaveLength(4);
    expect(result.postProcess![0].action).toBe("copy");
    expect(result.postProcess![1].action).toBe("patch");
    expect(result.postProcess![3].action).toBe("delete");
  });

  it("rejects config without projectDir", () => {
    expect(() => ExtractConfigSchema.parse({ destName: "test", appDirs: [] })).toThrow();
  });

  it("rejects config without destName", () => {
    expect(() => ExtractConfigSchema.parse({ projectDir: "apps/test", appDirs: [] })).toThrow();
  });

  it("rejects patch rule without find+replace or removeLinesMatching", () => {
    const config = {
      projectDir: "apps/test",
      destName: "test",
      appDirs: [],
      postProcess: [{ action: "patch", file: "ts.ts" }],
    };
    expect(() => ExtractConfigSchema.parse(config)).toThrow();
  });

  it("rejects patch rule with find but no replace", () => {
    const config = {
      projectDir: "apps/test",
      destName: "test",
      appDirs: [],
      postProcess: [{ action: "patch", file: "ts.ts", find: "old" }],
    };
    expect(() => ExtractConfigSchema.parse(config)).toThrow();
  });

  it("applies default workspacePrefixes", () => {
    const config = {
      projectDir: "apps/test",
      destName: "test",
      appDirs: [],
    };
    const result = ExtractConfigSchema.parse(config);
    expect(result.workspacePrefixes).toEqual(["@syrokomskyi/", "@warpgogol/"]);
  });
});
