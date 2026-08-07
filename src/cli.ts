#!/usr/bin/env node
/*
<MODULE_CONTRACT>
<purpose>CLI entrypoint for @warpgogol/repo-extract.</purpose>
<non-goals>
  <item>Does not implement extraction logic (see extract.ts).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial CLI for RFC-0070. Supports --config, --dest, --dry-run, --verbose flags.</item>
  <item>RFC-0074: Catch SecretScanError, GitOperationError, PackageManagerError and exit with code 1. Pass verbose: true.</item>
</CHANGE_SUMMARY>
*/

import { Command } from "commander";
import { loadConfig } from "./config.js";
import { extractProject } from "./extract.js";
import { SecretScanError, GitOperationError, PackageManagerError } from "./errors.js";

const program = new Command();

program
  .name("repo-extract")
  .description(
    "Extract apps and packages from a TurboRepo monorepo into standalone public repositories",
  )
  .option("--config <path>", "Path to extract.config.yaml")
  .option("--dest <path>", "Destination directory (overrides config default)")
  .option("--dry-run", "Print plan without writing files")
  .option("--verbose", "Verbose output")
  .action(async (opts: { config?: string; dest?: string; dryRun?: boolean; verbose?: boolean }) => {
    if (!opts.config) {
      console.error("Error: --config is required");
      program.outputHelp();
      process.exit(1);
    }

    const config = await loadConfig(opts.config);
    try {
      await extractProject(config, {
        dest: opts.dest,
        dryRun: opts.dryRun,
        verbose: true,
      });
    } catch (err) {
      if (err instanceof SecretScanError) {
        console.error(`\n!!! ABORTED: ${err.findings.length} secret(s) detected !!!`);
        for (const f of err.findings) {
          console.error(`  ${f.file}:${f.line} — ${f.name}`);
          console.error(`    ${f.preview}`);
        }
        console.error(
          "\nExport aborted. Fix the source files or add directories to ignoreDirs in config.",
        );
        process.exit(1);
      }
      if (err instanceof GitOperationError) {
        console.error(`\nGit error: ${err.message}`);
        process.exit(1);
      }
      if (err instanceof PackageManagerError) {
        console.error(`\nPackage manager error: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
  });

program.parse();
