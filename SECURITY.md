# Security

## Reporting a vulnerability

If you discover a security vulnerability in this package, please:

1. Open a private [GitHub security advisory](https://github.com/syrokomskyi/repo-extract/security/advisories/new), or
2. Contact the maintainer via [GitHub profile](https://github.com/syrokomskyi).

Please **do not** open a public issue for security-related problems.

## Response timeline

- Acknowledgement: within 48 hours
- Initial assessment: within 7 days
- Fix or mitigation: depends on severity, typically within 30 days for high-severity issues

## Scope

This package reads files from your monorepo and writes extracted projects to disk. It also includes an optional secret scanner that checks for common secret patterns before publishing. Be aware that:

- The secret scanner is heuristic, not exhaustive — always review exported content manually before publishing
- `skipSecretScan: true` in `extract.config.yaml` disables scanning entirely
- No data is sent to external services — all operations are local filesystem only
- Git credentials are used only for push operations when `autoPush: true` is configured

## Out of scope

- Vulnerabilities in git itself or the hosting platform (GitHub, GitLab, etc.)
- Issues arising from misconfigured `extract.config.yaml` that excludes sensitive files
- Problems in the extracted downstream repositories
