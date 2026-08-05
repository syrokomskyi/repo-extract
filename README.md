# @warpgogol/repo-extract

Extract apps and packages from a TurboRepo monorepo into standalone public repositories.

## Usage

### CLI

```sh
repo-extract --config apps/hdri/extract.config.yaml
repo-extract --config apps/hdri/extract.config.yaml --dry-run
repo-extract --config apps/hdri/extract.config.yaml --dest /path/to/dest --verbose
```

### Programmatic API

```ts
import { extractProject, loadConfig } from "@warpgogol/repo-extract";

const config = await loadConfig("apps/hdri/extract.config.yaml");
await extractProject(config, { dest: "../clients/hdri" });
```

## Configuration

See `extract.config.yaml` format in the RFC-0070 design section.

## License

Apache-2.0
