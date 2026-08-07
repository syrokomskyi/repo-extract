/*
<MODULE_CONTRACT>
<purpose>Detect package manager from lockfile presence in source root.</purpose>
<non-goals>
  <item>Does not install packages or generate lockfiles (see extract.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0072: Initial detectPackageManager() pure function.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import * as path from "node:path";
import type { PackageManager } from "./types.js";

export function detectPackageManager(root: string): PackageManager {
  const lockfiles: { file: string; pm: PackageManager }[] = [
    { file: "pnpm-lock.yaml", pm: "pnpm" },
    { file: "yarn.lock", pm: "yarn" },
    { file: "package-lock.json", pm: "npm" },
  ];

  const found: PackageManager[] = [];
  for (const { file, pm } of lockfiles) {
    if (existsSync(path.join(root, file))) {
      found.push(pm);
    }
  }

  if (found.length > 1) {
    console.warn(
      `Warning: multiple lockfiles found in ${root}, using ${found[0]} (priority: pnpm > yarn > npm)`,
    );
  }

  return found[0] ?? "pnpm";
}
