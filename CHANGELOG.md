# Changelog

All notable changes to the `repo-extract` project are documented here.

## 1.4.3 — 2026-10-10

### Fixed

- Generated `ci.yml` no longer assumes a lockfile ships: when the export's lockfile is absent at workflow-generation time (e.g. `excludePathSegments`/`postProcess` drop `pnpm-lock.yaml` because it embeds a local `link:` dep), the workflow omits `cache: <pm>` from `setup-node` and installs with `--no-frozen-lockfile`/`npm install` instead of failing at setup-node's "Dependencies lock file is not found".

## 1.4.2 — 2026-10-10

### Fixed

- `--no-push` now actually suppresses the push: commander maps the negated flag to `opts.push === false`, so the previous `opts.noPush` read was always `undefined` and `autoPush` still fired before orchestrated verification (observed in the werkstatt `publish:forge` run — the destination pushed inside `extractProject` instead of after it).
- Lockfile generation passes `--ignore-workspace` to `pnpm install` — a destination nested inside another pnpm workspace previously routed the install to the ancestor workspace root, so the export shipped without `pnpm-lock.yaml` and CI's `--frozen-lockfile` install failed (observed in the repo-extract self-export under `packages/packages/`).

## 1.4.0 — 2026-10-10

### Added

- RFC-0131: fail-closed dirty-source preflight over every source path the export reads (declared dirs, monorepo config defaults, root manifests/tsconfig targets, preserved packages' manifests) — aborts with a grouped offender list unless `--allow-dirty`/`allowDirty: true`.
- RFC-0131: `--from-head`/`--ref` clean-source export via a temporary git worktree; `source: "head"` config equivalent; `versionBump`×head and `--allow-dirty`×head rejected to prevent version drift.
- RFC-0131: `--no-push` flag to commit the export locally without pushing (overrides `git.autoPush`).
- RFC-0131: `git.autoReconcile` — on a non-fast-forward push rejection, fetch + `merge -s ours --allow-unrelated-histories` + one retry (local tree is the authoritative export); unrelated-history grafts log a warning.

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
