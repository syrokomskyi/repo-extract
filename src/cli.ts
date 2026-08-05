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
</CHANGE_SUMMARY>
*/

import { Command } from "commander";
import { loadConfig } from "./config.js";
import { extractProject } from "./extract.js";

const program = new Command();

program
  .name("repo-extract")
  .description("Extract apps and packages from a TurboRepo monorepo into standalone public repositories")
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
    await extractProject(config, {
      dest: opts.dest,
      dryRun: opts.dryRun,
      verbose: opts.verbose,
    });
  });

program.parse();
