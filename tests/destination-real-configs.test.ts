import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

// Monorepo-bound by construction: probes the real sibling pipeline-*
// extract configs, which exist only in the source monorepo layout
// (packages/pipeline/...). Excluded from the standalone export via
// excludePathSegments — there the paths would be absent by design.
describe("locked destination preflight — real monorepo configs", () => {
  it.each(["core", "ai", "node", "steps"])(
    "enables protection in the real pipeline-%s config",
    async (name) => {
      const loaded = await loadConfig(
        new URL(`../../pipeline/pipeline-${name}/extract.config.yaml`, import.meta.url).pathname,
      );
      expect(loaded.lockDestination).toBe(true);
      expect(loaded.destBase).toBe("packages");
    },
  );
});
