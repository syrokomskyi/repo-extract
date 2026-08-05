import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/repo-extract/tests/**/*.test.ts"],
  },
});
