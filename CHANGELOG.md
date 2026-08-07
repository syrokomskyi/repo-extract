# Changelog

All notable changes to the `repo-extract` project are documented here.
## 2026-07-30 .. 2026-08-05

### Added
- Create @warpgogol/repo-extract package with complete CLI, config schema, core orchestrator, post-processing, changelog integration, git helpers, and shared types per RFC-0070.
- Add secret scanner with configurable ignoreDirs and filtered spec/ directories to prevent credential leakage in repo-extract.
- Add ability for repo-extract to preserve @warpgogol/* in peerDependencies and to transfer filtered git history and generate CI workflow in exported repositories.
- Implement comprehensive test suites for config, transform, postprocess, and integration in repo-extract.
- Add changelog.config.yaml and changelog-live as devDependency to all missing packages and apps.
- Enable skipSecretScan and autoPush options in repo-extract's self-export config.
- Mark RFC-0070 step 19 as implemented and document agents involved in repo-extract.

### Changed
- Rename @wgogol/changelog-live to @warpgogol/changelog-live in all relevant packages, documentation and config files.
- Prepare changelog-live and repo-extract packages for public release with config and documentation updates.

### Fixed
- Repair failing test suites for upload-service, repo-extract, and crawler.
- Improve repo-extract scanner to skip secret matches inside string literals.

### Security
- Prevent credential leakage in exported repositories by enhancing secret scanning and directory filtering in repo-extract.

### Documentation
- Add and update documentation, README, CODE_OF_CONDUCT, CONTRIBUTING, SECURITY, and AGENTS files for changelog-live and repo-extract packages.

## 2026-07-23 .. 2026-07-29

### Added
- Add `@warpgogol/repo-extract` package with CLI, programmatic API, and Zod-validated configuration.
- Add standalone export mode for single-package flattening.
- Add declarative post-process rules (copy, patch, delete).
- Add optional `@warpgogol/changelog-live` integration via dynamic import.
- Add secret scanning with configurable skip.
