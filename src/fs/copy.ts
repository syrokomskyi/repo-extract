/*
<MODULE_CONTRACT>
<purpose>Filtered filesystem copy utilities for monorepo export.</purpose>
<non-goals>
  <item>Does not transform package.json (see transform.ts).</item>
  <item>Does not discover dependencies (see discover.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Ported copyFiltered, copyStandalonePackage, removeDest from scripts/export-clients-helpers.ts for RFC-0070.</item>
  <item>RFC-0071: Split IGNORE_DIRS into BASE_IGNORE_DIRS (org-neutral) and config-driven ignoreDirs. MONOREPO_CONFIG_FILES kept as auto-detect candidate list.</item>
  <item>RFC-0072: Extended IGNORE_FILES with package-lock.json and yarn.lock. Added getMonorepoConfigFiles(pm) to filter pnpm-workspace.yaml for npm/yarn.</item>
  <item>RFC-0075: Consolidated inline import in truncateCsv to top-level. Made isKeyMaterial/isDbFile configurable via excludePathSegments/excludeExtensions.</item>
</CHANGE_SUMMARY>
*/

import { cp, mkdir, readdir, rm, readFile, writeFile } from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import type { PackageManager } from "../types.js";

const BASE_IGNORE_DIRS = new Set([
  "node_modules",
  ".turbo",
  "dist",
  ".env",
  ".DS_Store",
  "Thumbs.db",
]);

const IGNORE_FILES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "changelog.config.yaml",
]);

const MONOREPO_CONFIG_FILES = [
  "turbo.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.app.json",
  "eslint.config.mjs",
  ".prettierrc.mjs",
  ".prettierignore",
  ".markdownlint.json",
  ".nvmrc",
  ".dockerignore",
];

export function getMonorepoConfigFiles(pm: PackageManager): string[] {
  if (pm !== "pnpm") {
    return MONOREPO_CONFIG_FILES.filter((f) => f !== "pnpm-workspace.yaml");
  }
  return [...MONOREPO_CONFIG_FILES];
}

export function isIgnored(name: string, extraIgnoreDirs?: string[]): boolean {
  if (BASE_IGNORE_DIRS.has(name) || IGNORE_FILES.has(name) || name.endsWith(".tsbuildinfo")) {
    return true;
  }
  if (extraIgnoreDirs && extraIgnoreDirs.includes(name)) {
    return true;
  }
  return false;
}

export function isKeyMaterial(relPath: string, excludePathSegments?: string[]): boolean {
  const segments = excludePathSegments ?? [
    ".input" + path.sep + "signing-key",
    ".input" + path.sep + "batches",
  ];
  return segments.some((seg) => relPath.includes(seg));
}

export function isDbFile(name: string, excludeExtensions?: string[]): boolean {
  const extensions = excludeExtensions ?? [".db"];
  return extensions.some((ext) => name.endsWith(ext));
}

export async function ensureDir(p: string): Promise<void> {
  await mkdir(p, { recursive: true });
}

export async function removeDest(dest: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dest, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "LICENSE") continue;
    await rm(path.join(dest, e.name), { recursive: true, force: true });
  }
}

export async function copyFile(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest));
  await cp(src, dest);
}

export async function copyFiltered(
  srcRoot: string,
  destRoot: string,
  subDir: string = "",
  extraIgnoreDirs?: string[],
  excludePathSegments?: string[],
  excludeExtensions?: string[],
): Promise<number> {
  const srcDir = path.join(srcRoot, subDir);
  const destDir = path.join(destRoot, subDir);
  let count = 0;

  let entries: Dirent[];
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const name = entry.name;
    const relPath = subDir ? `${subDir}${path.sep}${name}` : name;

    if (
      isIgnored(name, extraIgnoreDirs) ||
      isKeyMaterial(relPath, excludePathSegments) ||
      isDbFile(name, excludeExtensions)
    )
      continue;

    const srcPath = path.join(srcDir, name);
    const destPath = path.join(destDir, name);

    if (entry.isDirectory()) {
      count += await copyFiltered(
        srcRoot,
        destRoot,
        relPath,
        extraIgnoreDirs,
        excludePathSegments,
        excludeExtensions,
      );
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
      count++;
    }
  }
  return count;
}

export async function copyStandalonePackage(
  srcRoot: string,
  dest: string,
  packageDir: string,
  ignoreDirs?: string[],
  excludePathSegments?: string[],
  excludeExtensions?: string[],
): Promise<number> {
  const srcDir = path.join(srcRoot, packageDir);
  const skipNames = new Set(["node_modules", ".turbo"]);
  if (ignoreDirs) {
    for (const d of ignoreDirs) skipNames.add(d);
  }

  let count = 0;
  await cp(srcDir, dest, {
    recursive: true,
    filter: (src) => {
      if (src === srcDir) return true;
      const name = path.basename(src);
      if (skipNames.has(name) || name.endsWith(".tsbuildinfo")) return false;
      const relPath = path.relative(srcDir, src);
      if (isKeyMaterial(relPath, excludePathSegments) || isDbFile(name, excludeExtensions))
        return false;
      try {
        if (fsSync.statSync(src).isFile()) count++;
      } catch {
        /* no-op */
      }
      return true;
    },
  });

  return count;
}

export async function copyBatchSample(
  srcRoot: string,
  destRoot: string,
  htmlLimit: number,
): Promise<void> {
  let htmlCount = 0;

  async function walk(dirRel: string): Promise<boolean> {
    if (htmlCount >= htmlLimit) return false;

    const srcDir = path.join(srcRoot, dirRel);
    const destDir = path.join(destRoot, dirRel);

    let entries: Dirent[];
    try {
      entries = await readdir(srcDir, { withFileTypes: true });
    } catch {
      return true;
    }

    const subdirs: string[] = [];

    for (const entry of entries) {
      const name = entry.name;
      if (name === "." || name === "..") continue;

      const relPath = dirRel ? `${dirRel}/${name}` : name;
      const srcPath = path.join(srcDir, name);
      const destPath = path.join(destDir, name);

      if (entry.isDirectory()) {
        subdirs.push(relPath);
      } else if (entry.isFile()) {
        const isHtml = /\.html?$/i.test(name);
        const isCsv = /\.csv$/i.test(name);

        if (isHtml && htmlCount >= htmlLimit) continue;

        await ensureDir(path.dirname(destPath));

        if (isHtml) {
          htmlCount++;
          await cp(srcPath, destPath);
        } else if (isCsv) {
          await truncateCsv(srcPath, destPath, CSV_LIMIT);
        } else {
          await cp(srcPath, destPath);
        }
      }
    }

    for (const sd of subdirs) {
      if (htmlCount >= htmlLimit) break;
      if (!(await walk(sd))) return false;
    }

    return true;
  }

  await walk("");
  const files = htmlCount <= htmlLimit ? htmlCount : htmlLimit;
  console.log(`  batch HTML files sampled: ${files}`);
}

const CSV_LIMIT = 50;

export async function truncateCsv(
  srcPath: string,
  destPath: string,
  csvLimit: number,
): Promise<void> {
  const content = await readFile(srcPath, "utf-8");
  const lines = content.split("\n");
  const header = lines[0] || "";
  const dataLines = lines.slice(1).filter((l) => l.trim().length > 0);
  const sampled = dataLines.slice(0, csvLimit);
  let result = [header, ...sampled].join("\n");
  if (!result.endsWith("\n")) result += "\n";
  await writeFile(destPath, result, "utf-8");
}

export { MONOREPO_CONFIG_FILES };
