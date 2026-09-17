# Releases, recipes and packs

One ClawScarf version identifies a CLI and its matching platform bundle. Recipes live
in [deploy/recipes](../deploy/recipes/README.md), packs in [packs](../packs/README.md).
They ship together; there is no separate recipe repository, registry or dependency
resolver. A recipe selects packs and agent members from that release. Updating a
recipe or bundled pack produces a new ClawScarf release. Existing installations keep
their selected release and editable settings until an explicit change.

## Distribution

The publication design is:

| Location                  | Contents                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| npm: `@clawscarf/cli`     | Compiled `clawscarf` command and its operator assets. No source checkout or TypeScript build for users. |
| GitHub Releases: `vX.Y.Z` | Matching platform payload archives, release metadata, checksums and required license/source notices.    |
| GHCR                      | Application, companion and forwarding images referenced by registry digest in the release metadata.     |

The intended first command is `npx @clawscarf/cli@latest install`. npm chooses the
CLI version; that CLI downloads its **exact matching** platform bundle, verifies it,
and retains the operator and payloads outside npm's temporary cache. An explicit npm
version selects an older release. Ordinary startup never resolves `latest` again.
Recipes are chosen from the selected release, not fetched independently. Prereleases
remain opt-in. A published version is immutable; corrections get a new version.

**Publication and automatic downloading are not implemented.** The operator archive
already has a `clawscarf` executable entry, but remains private and unpublished. Local
image IDs are accepted for development; publication must use pullable registry digests.
Only macOS arm64 is currently supported. Packaging does not establish other-platform
support, clean-machine installation or runtime behavior.

## Development bundles today

From already-built components, run:

```sh
pnpm clawscarf release-create --input /absolute/built-components.json \
  --output /absolute/release-bundle
pnpm clawscarf install --release /absolute/release-bundle/clawscarf-release.json \
  --directory /absolute/new-team
```

The output is a movable directory:

```text
release-bundle/
  clawscarf-release.json   # version, image digests, recipes, models, payload hashes
  tools/
    openshell
    openshell-gateway
  packs/                  # only the selected release packs
    research-team/
      pack.json
      researcher/CLAW.md
      researcher/profiles/openclaw.yml
      reviewer/...
  connectors/             # optional validated index and action-schema files
  LICENSE
  THIRD_PARTY_NOTICES.md
```

The builder copies tools and payloads; it does not retain paths into the build
checkout. It rejects missing recipe packs/members, duplicate agent selections,
invalid catalogs and non-executable tools. Tool checksums and pack digests cover
the copied bytes; setup verifies bundled packs again. Repeating assembly with the
same inputs produces the same metadata and content digests. This is not a claim
of byte-identical image builds or compressed archives.

Build inputs follow the [release schema](../scripts/release/definition.ts), except
`tools.openshell.cli` and `gateway` are source executable paths and `packs` is an
array of source directories. `images.openshellClient` is the exact built
[forwarding image](../deploy/images/README.md#openshell-forwarding-image); the upstream
controller image is pinned in the [component manifest](components.json). Paths resolve
relative to the input file. The builder
embeds recipe objects supplied in `recipes`; the default model catalog comes from
[deploy/models/catalog.json](../deploy/models/catalog.json). An optional
`cloudUrl` supplies the hosted login service origin; development can override it with
`install --cloud-url`. No cloud service has been deployed yet.
`connectorCatalogDirectory` supplies a prepared catalog; only validated runtime
catalog files are copied, not importer state or adjacent credentials.

A recipe's pack selection is small JSON, for example:

```json
{ "packs": [{ "id": "research-team", "members": ["researcher", "reviewer"] }] }
```

The files are not embedded in that JSON. Members remain native OpenClaw Claws and
use its install/update/remove operations. ClawScarf's group manifest records shared
requirements. The illustrative Team documents recipe still selects no pack; wiring
packs into releases does not make that example a finished document workflow.

The CLI, Docker images and pack operator's Python SDK are still separate development
prerequisites. This command assembles payloads; it does not build images, install the
SDK or publish a complete download. Keep the resulting bundle available to the
installation. [Local installation](../deploy/deployment/installation.md) and
[operator packaging](operator.md) describe the current commands and limitations.
