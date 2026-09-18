# Runtime releases, recipes and packs

These have separate responsibilities:

| Definition      | Owns                                                                                             | Location                                               |
| --------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Runtime release | Exact software images, OpenShell executables, checksums and supported platforms                  | [runtime/releases](../runtime/releases/0.1.0-dev.json) |
| Recipe          | A fixed runtime reference plus editable model, reasoning, resource, capability and pack defaults | [recipes](../recipes/README.md)                        |
| Pack            | Native agent, skill and workflow files with declared prerequisites                               | [packs](../packs/README.md)                            |

Several recipes can use the same runtime. A runtime contains no recipes, model
catalog or pack selections. Changing a recipe does not require rebuilding its runtime.
Recipes and packs ship with the CLI; there is no separate registry or dependency resolver.
The [model catalog](../deploy/models/catalog.json) is also a CLI asset. Recipe IDs select
catalog entries; model protocols and limits have one definition.

## Current development use

```sh
clawscarf configure
# Or use staging for hosted login and Connections:
clawscarf configure --cloud-url https://cloud-staging.clawscarf.com
```

No recipe argument opens the bundled recipe menu. `--recipe team-documents` selects
that bundled definition; `--recipe /path/to/recipe.json` reads a custom one. Its
`runtime` path resolves relative to the recipe file. The runtime cannot be changed
in the settings menu. `--directory` defaults to `~/clawscarf-team`.

The tracked [development runtime](../runtime/releases/0.1.0-dev.json) currently names
locally built Docker image IDs and checksum-pinned OpenShell tools under ignored
`runtime/tools/0.0.116/`. It works on the prepared development machine; it is **not a
published, clean-machine release**. Definitions belong in the tracked directories
above. Compiled images, binaries and test artifacts are not source definitions.

The current platform is macOS arm64 with Docker Desktop. Setup validates the host,
tools and ports; it can pull registry images pinned by digest. It cannot recover a
missing local image ID or download missing OpenShell binaries yet. See the
[installation guide](../deploy/deployment/installation.md) for diagnostics.

## Publishing structure

The intended distribution uses:

- npm `@clawscarf/cli`: compiled CLI, recipes, pack files, model catalog and runtime
  definitions. No Docker images or large OpenShell executables in npm.
- GitHub Releases: versioned runtime tool archives, checksums and required notices.
- GHCR: runtime/companion images referenced by immutable registry digest.

Installing a newer CLI supplies newer recipes. Each recipe still selects an exact
runtime; startup never resolves “latest.” Existing installations retain their
accepted settings and runtime. Explicit configuration changes preserve unrelated
native edits. The CLI package version and a runtime version need not be the same.

The operator archive already includes the small catalogs and pack trees. Publication,
runtime tool downloading and a complete clean-machine release remain in
[TODO.md](../TODO.md). Do not describe the development archive as a published installer.

## Assemble runtime artifacts

For release development, the existing builder copies already-built tools into a
movable directory:

```sh
clawscarf release-create --input /absolute/built-components.json \
  --output /absolute/runtime-bundle
```

The input follows the [runtime schema](../scripts/release/definition.ts), except
`tools.openshell.cli` and `gateway` are source executable paths. Relative inputs
resolve beside that input file. The result is:

```text
runtime-bundle/
  clawscarf-release.json
  LICENSE
  THIRD_PARTY_NOTICES.md
  tools/openshell
  tools/openshell-gateway
```

The builder checks executable files, computes their checksums, refuses overwriting
an existing output directory and removes incomplete output on failure. It does not
build images, copy recipes/packs or publish artifacts. A custom recipe can point to
the resulting runtime definition. The [component pins](components.json) record
upstream sources; [operator packaging](operator.md) describes the CLI archive.
