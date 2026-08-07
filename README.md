# @warpgogol/repo-extract

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE) [![CI](https://img.shields.io/github/actions/workflow/status/syrokomskyi/repo-extract/ci.yml?logo=github-actions&logoColor=white)](https://github.com/syrokomskyi/repo-extract/actions) [![npm](https://img.shields.io/npm/v/@warpgogol/repo-extract?logo=npm&logoColor=white)](https://www.npmjs.com/package/@warpgogol/repo-extract)

Extract apps and packages from a TurboRepo monorepo into standalone public repositories.

## Features

- Extracts one or more workspace projects from a Turborepo monorepo
- **Standalone mode** for single-package export (flattens to repo root)
- **Monorepo mode** for multi-app export (preserves workspace structure)
- Declarative post-process rules: copy, patch, delete
- Optional `@warpgogol/changelog-live` integration for changelog generation
- Secret scanning with configurable skip
- Git history transfer by path prefix
- Auto-generated CI workflow with npm publish
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

## CLI flags

| Flag              | Description                                      |
| ----------------- | ------------------------------------------------ |
| `--config <path>` | Path to `extract.config.yaml` (required)         |
| `--dest <path>`   | Destination directory (overrides config default) |
| `--dry-run`       | Print plan without writing files                 |
| `--verbose`       | Verbose output                                   |

## Configuration

Create an `extract.config.yaml` in your project:

### Standalone single-package export

```yaml
projectDir: packages/my-package
destName: my-package
standalone: true

git:
  remote: git@github.com:user/my-package.git
  autoPush: true
```

Standalone mode flattens the package to the repo root — `src/`, `tests/`, `package.json`, etc. become top-level. Workspace dependencies (`workspace:*`) are replaced with `*`, and `@warpgogol/*` devDependencies are stripped (except the package itself).

### Multi-app monorepo export

```yaml
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

Monorepo mode preserves the workspace structure, copies monorepo config files (`turbo.json`, `pnpm-workspace.yaml`, etc.), auto-discovers package dependencies, and generates `tsconfig.base.json`.

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
  - action: patch
    file: tsconfig.json
    removeLinesMatching: "customConditions"
  - action: delete
    path: AGENTS.md
```

### Secret scanning

By default, the export scans for common secret patterns (AWS keys, private keys, GitHub tokens, generic API keys) before committing. If secrets are found, the export aborts.

```yaml
skipSecretScan: true  # disable scanning (not recommended)
ignoreDirs:
  - .input
  - spec
```

### Optional changelog integration

If `changelog.config.yaml` exists in the project directory and `@warpgogol/changelog-live` is installed, the export automatically generates a changelog before committing. The generated commit message includes the AI-generated changelog summary.

## Programmatic API

```ts
import { extractProject, loadConfig } from "@warpgogol/repo-extract";

const config = await loadConfig("extract.config.yaml");
await extractProject(config, { dest: "../my-package" });
```

### Exports

| Export                                     | Description                                  |
| ------------------------------------------ | -------------------------------------------- |
| `extractProject(config, options)`          | Run the full extraction pipeline             |
| `loadConfig(path)`                         | Load and validate an `extract.config.yaml`   |
| `scanForSecrets(dir)`                      | Scan a directory for secret patterns         |
| `transferGitHistory(root, dest, prefixes)` | Transfer filtered git history                |
| `commitExport(dest, message, gitConfig)`   | Commit and optionally push                   |
| `generateCiWorkflow()`                     | Generate a GitHub Actions CI workflow string |
| `fixStandalonePackageJson(dest)`           | Fix package.json for standalone export       |
| `fixStandaloneVitestConfig(dest)`          | Fix vitest.config.ts for standalone export   |

## Changelog

[CHANGELOG.md](CHANGELOG.md)

## License

Apache-2.0
