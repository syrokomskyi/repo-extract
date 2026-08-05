# @warpgogol/repo-extract

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE) [![CI](https://img.shields.io/github/actions/workflow/status/syrokomskyi/repo-extract/ci.yml?logo=github-actions&logoColor=white)](https://github.com/syrokomskyi/repo-extract/actions) [![npm](https://img.shields.io/npm/v/@warpgogol/repo-extract?logo=npm&logoColor=white)](https://www.npmjs.com/package/@warpgogol/repo-extract)

Extract apps and packages from a TurboRepo monorepo into standalone public repositories.

## Features

- Extracts one or more workspace projects from a Turborepo monorepo
- Standalone mode for single-package export (flattens to repo root)
- Monorepo mode for multi-app export (preserves workspace structure)
- Declarative post-process rules: copy, patch, delete
- Optional `@warpgogol/changelog-live` integration for changelog generation
- Secret scanning with configurable skip
- Zod-validated `extract.config.yaml` configuration
- CLI + programmatic API

## Quick start

```bash
# Install
npm install -g @warpgogol/repo-extract

# Extract a project (dry-run first)
repo-extract --config extract.config.yaml --dry-run

# Extract for real
repo-extract --config extract.config.yaml --dest /path/to/dest --verbose
```

Or use without global install:

```bash
npx @warpgogol/repo-extract --config extract.config.yaml --dry-run
```

## Configuration

Create an `extract.config.yaml` in your project:

```yaml
# Standalone single-package export
projectDir: packages/my-package
destName: my-package
standalone: true

git:
  remote: git@github.com:user/my-package.git
  autoPush: true
```

```yaml
# Multi-app monorepo export
projectDir: apps/my-app
destName: my-app

appDirs:
  - apps/my-app/frontend
  - apps/my-app/backend

projectRootFiles:
  - README.md
  - LICENSE
  - CONTRIBUTING.md

git:
  remote: git@github.com:user/my-app.git
  autoPush: true
```

### Post-process rules

```yaml
postProcess:
  - action: copy
    from: src/config.yaml
    to: dist/config.yaml
  - action: patch
    file: package.json
    find: "workspace:*"
    replace: "^1.0.0"
  - action: delete
    target: AGENTS.md
```

## Programmatic API

```ts
import { extractProject, loadConfig } from "@warpgogol/repo-extract";

const config = await loadConfig("extract.config.yaml");
await extractProject(config, { dest: "../my-package" });
```

## License

Apache-2.0
