# CLI archive

For normal installation and operation, use the [quickstart](../README.md#get-started)
and [CLI guide](../deploy/deployment/installation.md). This file describes the archive
layout; [release assembly](README.md) owns how artifacts are built and published.
The source links refer to the repository, not additional files in this archive.

## Standalone layout

The standalone archive contains `clawscarf/` with the command launcher, a private
`node/bin/node`, Node's license, and `package/` with the CLI, installed dependencies
and catalogs. Verify it against the same release's `SHA256SUMS`, then extract it.
Run `./clawscarf/clawscarf configure`; moving the complete directory preserves its
runtime and dependencies. The release installer performs this verification and
installation for normal use.

## JavaScript archive

The development JavaScript archive contains compiled operator code, its production
dependency lockfile, migrations, policy/helpers, recipes, packs and runtime definitions.
It excludes companion servers, Docker images, OpenShell executables and installation
state. Publisher dependencies and TypeScript sources are not runtime requirements.

With Node/pnpm matching [package.json](../package.json), verify the archive against
its `SHA256SUMS` and extract it into a new directory. Inside `package`:

```sh
pnpm install --prod --frozen-lockfile --ignore-scripts
node scripts/clawscarf.js --help
node scripts/clawscarf.js configure --directory /absolute/new-team
```

Keep installation data outside the extracted package. A development runtime that
references local image IDs needs those images prepared separately; see
[development releases](README.md#published-and-development-use).
The optional pack operator also needs its [Python dependencies](../packs/README.md#requirements-and-bindings).
Required [notices](../THIRD_PARTY_NOTICES.md) and dependency licenses accompany the payload.
