/*
<MODULE_CONTRACT>
<purpose>Typed error classes for library-grade API — distinguishes secret scan, git, and package manager failures.</purpose>
<non-goals>
  <item>Does not handle config validation errors (Zod throws ZodError).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0074: Initial error types — SecretScanError, GitOperationError, PackageManagerError.</item>
</CHANGE_SUMMARY>
*/

import type { SecretFinding } from "./types.js";

export class SecretScanError extends Error {
  readonly findings: SecretFinding[];
  constructor(findings: SecretFinding[]) {
    super(`Secret scan detected ${findings.length} secret(s) in export`);
    this.name = "SecretScanError";
    this.findings = findings;
  }
}

export class GitOperationError extends Error {
  readonly operation: string;
  override readonly cause?: Error;
  constructor(operation: string, message: string, cause?: Error) {
    super(`Git operation "${operation}" failed: ${message}`);
    this.name = "GitOperationError";
    this.operation = operation;
    this.cause = cause;
  }
}

export class PackageManagerError extends Error {
  readonly command: string;
  override readonly cause?: Error;
  constructor(command: string, message: string, cause?: Error) {
    super(`Package manager command "${command}" failed: ${message}`);
    this.name = "PackageManagerError";
    this.command = command;
    this.cause = cause;
  }
}
