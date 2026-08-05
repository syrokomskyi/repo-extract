/*
<MODULE_CONTRACT>
<purpose>Auto-discovery of transitive workspace package dependencies.</purpose>
<non-goals>
  <item>Does not copy or transform files (see copy.ts, transform.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Ported discoverPackageDeps from scripts/export-clients-helpers.ts for RFC-0070. Supports both @syrokomskyi/ and @warpgogol/ prefixes.</item>
</CHANGE_SUMMARY>
*/

import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import { isIgnored } from "./copy.js";

export async function discoverPackageDeps(
  root: string,
  appDirs: string[],
  workspacePrefixes: string[] = ["@syrokomskyi/", "@warpgogol/"],
): Promise<string[]> {
  const visited = new Set<string>();
  const result = new Set<string>();

  async function resolvePkg(pkgName: string): Promise<void> {
    if (visited.has(pkgName)) return;
    visited.add(pkgName);

    const pkgDir = await findPackageDir(root, pkgName);
    if (!pkgDir) return;

    const relDir = path.relative(root, pkgDir).replace(/\\/g, "/");
    result.add(relDir);

    const pkgJsonPath = path.join(pkgDir, "package.json");
    try {
      const raw = await readFile(pkgJsonPath, "utf-8");
      const pkg = JSON.parse(raw);
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };
      for (const depName of Object.keys(allDeps)) {
        for (const prefix of workspacePrefixes) {
          if (depName.startsWith(prefix)) {
            await resolvePkg(depName);
            break;
          }
        }
      }
    } catch {
      /* no-op */
    }
  }

  for (const appDir of appDirs) {
    await resolveAppDeps(root, appDir, resolvePkg, workspacePrefixes);
  }

  return Array.from(result).sort();
}

async function resolveAppDeps(
  root: string,
  appDir: string,
  resolvePkg: (name: string) => Promise<void>,
  workspacePrefixes: string[],
): Promise<void> {
  const appPkgPath = path.join(root, appDir, "package.json");
  try {
    const raw = await readFile(appPkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    for (const depName of Object.keys(allDeps)) {
      for (const prefix of workspacePrefixes) {
        if (depName.startsWith(prefix)) {
          await resolvePkg(depName);
          break;
        }
      }
    }
  } catch {
    /* no-op */
  }

  const fullDir = path.join(root, appDir);
  try {
    const entries = await readdir(fullDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !isIgnored(entry.name)) {
        const subDir = path.join(appDir, entry.name);
        const subPkg = path.join(fullDir, entry.name, "package.json");
        try {
          await readFile(subPkg, "utf-8");
          await resolveAppDeps(root, subDir, resolvePkg, workspacePrefixes);
        } catch {
          /* no package.json in this subdir, skip */
        }
      }
    }
  } catch {
    /* no-op */
  }
}

async function findPackageDir(root: string, pkgName: string): Promise<string | null> {
  const packagesDir = path.join(root, "packages");

  async function searchDir(dir: string): Promise<string | null> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || isIgnored(entry.name)) continue;
      const subDir = path.join(dir, entry.name);
      const pkgJsonPath = path.join(subDir, "package.json");
      try {
        const raw = await readFile(pkgJsonPath, "utf-8");
        const pkg = JSON.parse(raw);
        if (pkg.name === pkgName) {
          return subDir;
        }
      } catch {
        /* no package.json here — recurse into subdirectory */
      }
      const found = await searchDir(subDir);
      if (found) return found;
    }
    return null;
  }

  return searchDir(packagesDir);
}
