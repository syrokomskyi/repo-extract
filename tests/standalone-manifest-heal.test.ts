/*
<MODULE_CONTRACT>
<purpose>RFC-0132 — standalone manifest self-healing: typecheck synthesis, repository field, passWithNoTests tolerance.</purpose>
</MODULE_CONTRACT>
*/

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  ensureTypecheckScript,
  ensureRepositoryField,
  ensureTestScriptTolerant,
  hasAnyTestFiles,
} from "../src/fs/transform.js";

describe("ensureTypecheckScript", () => {
  it("synthesizes typecheck from a pnpm-exec tsc build", () => {
    const pkg = { scripts: { build: "pnpm exec tsc -p tsconfig.json" } };
    expect(ensureTypecheckScript(pkg)).toBe(true);
    expect(pkg.scripts.typecheck).toBe("pnpm exec tsc -p tsconfig.json --noEmit");
  });

  it("synthesizes typecheck from a bare tsc build", () => {
    const pkg = { scripts: { build: "tsc -p tsconfig.build.json" } };
    expect(ensureTypecheckScript(pkg)).toBe(true);
    expect(pkg.scripts.typecheck).toBe("tsc -p tsconfig.build.json --noEmit");
  });

  it("no-ops when typecheck already exists", () => {
    const pkg = { scripts: { build: "tsc -p x.json", typecheck: "tsc -p x.json --noEmit" } };
    expect(ensureTypecheckScript(pkg)).toBe(false);
  });

  it("no-ops on composed builds — the flag would land on the wrong segment", () => {
    const pkg = { scripts: { build: "tsc -p a.json && tsc -p b.json" } };
    expect(ensureTypecheckScript(pkg)).toBe(false);
  });

  it("no-ops on non-tsc builds", () => {
    const pkg = { scripts: { build: "vite build" } };
    expect(ensureTypecheckScript(pkg)).toBe(false);
  });
});

describe("ensureRepositoryField", () => {
  it("synthesizes repository from an ssh remote", () => {
    const pkg: { repository?: unknown } = {};
    expect(ensureRepositoryField(pkg, "git@github.com:acme/widgets.git")).toBe(true);
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/acme/widgets.git",
    });
  });

  it("synthesizes repository from an https remote", () => {
    const pkg: { repository?: unknown } = {};
    expect(ensureRepositoryField(pkg, "https://github.com/acme/widgets")).toBe(true);
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/acme/widgets.git",
    });
  });

  it("leaves a declared repository untouched even when mismatched", () => {
    const existing = { type: "git", url: "git+https://github.com/other/repo.git" };
    const pkg = { repository: existing };
    expect(ensureRepositoryField(pkg, "git@github.com:acme/widgets.git")).toBe(false);
    expect(pkg.repository).toBe(existing);
  });

  it("no-ops without a remote", () => {
    const pkg: { repository?: unknown } = {};
    expect(ensureRepositoryField(pkg, undefined)).toBe(false);
  });
});

describe("test-script tolerance", () => {
  it("appends --passWithNoTests to a vitest script", () => {
    const pkg = { scripts: { test: "vitest run" } };
    expect(ensureTestScriptTolerant(pkg)).toBe(true);
    expect(pkg.scripts.test).toBe("vitest run --passWithNoTests");
  });

  it("is idempotent", () => {
    const pkg = { scripts: { test: "vitest run --passWithNoTests" } };
    expect(ensureTestScriptTolerant(pkg)).toBe(false);
  });

  it("leaves non-test-runner scripts alone", () => {
    const pkg = { scripts: { test: "node ./run-checks.mjs" } };
    expect(ensureTestScriptTolerant(pkg)).toBe(false);
  });
});

describe("hasAnyTestFiles", () => {
  it("finds test files below the export root", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "re-heal-"));
    try {
      mkdirSync(path.join(dir, "src", "tests"), { recursive: true });
      writeFileSync(path.join(dir, "src", "tests", "x.test.ts"), "");
      expect(hasAnyTestFiles(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false when only node_modules carries tests", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "re-heal-"));
    try {
      mkdirSync(path.join(dir, "node_modules", "dep"), { recursive: true });
      writeFileSync(path.join(dir, "node_modules", "dep", "x.test.js"), "");
      writeFileSync(path.join(dir, "src.ts"), "");
      expect(hasAnyTestFiles(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
