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
</CHANGE_SUMMARY>
*/

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import type { Dirent } from "node:fs";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".turbo",
  ".output",
  ".debug",
  ".debug-public",
  "dist",
  ".astro",
  ".agents",
  "spec",
]);

const IGNORE_FILES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  "pnpm-lock.yaml",
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

export function isIgnored(name: string, extraIgnoreDirs?: string[]): boolean {
  if (IGNORE_DIRS.has(name) || IGNORE_FILES.has(name) || name.endsWith(".tsbuildinfo")) {
    return true;
  }
  if (extraIgnoreDirs && extraIgnoreDirs.includes(name)) {
    return true;
  }
  return false;
}

export function isKeyMaterial(relPath: string): boolean {
  return relPath.includes(".input" + path.sep + "signing-key");
}

export function isDbFile(name: string): boolean {
  return name.endsWith(".db");
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

    if (relPath.includes(".input" + path.sep + "batches")) continue;

    if (isIgnored(name, extraIgnoreDirs) || isKeyMaterial(relPath) || isDbFile(name)) continue;

    const srcPath = path.join(srcDir, name);
    const destPath = path.join(destDir, name);

    if (entry.isDirectory()) {
      count += await copyFiltered(srcRoot, destRoot, relPath, extraIgnoreDirs);
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
): Promise<number> {
  const srcDir = path.join(srcRoot, packageDir);
  const skipNames = new Set([
    "node_modules",
    ".turbo",
    ".output",
    ".debug",
    ".debug-public",
    "changelog.config.yaml",
  ]);

  let count = 0;
  await cp(srcDir, dest, {
    recursive: true,
    filter: (src) => {
      if (src === srcDir) return true;
      const name = path.basename(src);
      if (skipNames.has(name) || name.endsWith(".tsbuildinfo")) return false;
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
  const { readFile, writeFile } = await import("node:fs/promises");
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
