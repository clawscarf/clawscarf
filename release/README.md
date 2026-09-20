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

## Published and development use

```sh
npm install -g @clawscarf/cli@next
clawscarf configure
# Or use staging for hosted login and Connections:
clawscarf configure --cloud-url https://cloud-staging.clawscarf.com
```

No recipe argument opens the bundled recipe menu. `--recipe team-server` selects
that bundled definition; `--recipe /path/to/recipe.json` reads a custom one. Its
`runtime` path resolves relative to the recipe file. The runtime cannot be changed
in the settings menu. `--directory` defaults to `~/clawscarf-team`.

The tracked [development runtime](../runtime/releases/0.1.0-dev.json) currently names
locally built Docker image IDs and checksum-pinned OpenShell tools under ignored
`runtime/tools/0.0.116/`. It works on the prepared development machine; it is **not a
published, clean-machine release**. Definitions belong in the tracked directories
above. Compiled images, binaries and test artifacts are not source definitions.

Published candidates include macOS arm64 and Linux arm64/x86-64 tools, with Linux
container images for both architectures. Windows uses the Linux CLI inside WSL2
(experimental);
Docker Desktop must expose its Linux engine to that distribution. Intel Mac is blocked
by the pinned upstream OpenShell release lacking a Darwin x86-64 executable.
See the [upstream support matrix](https://docs.nvidia.com/openshell/reference/support-matrix)
for host requirements. Setup validates the host,
tools and ports; it pulls registry images by digest and downloads missing runtime tools
when their definition supplies an HTTPS URL and SHA-256. It cannot recover a missing
local development image ID. See the
[installation guide](../deploy/deployment/installation.md) for diagnostics.

## Publishing structure

Release candidates contain:

- npm `@clawscarf/cli`: compiled CLI, recipes, pack files, model catalog and runtime
  definitions. No Docker images or large OpenShell executables in npm.
- GitHub Releases: versioned runtime tool archives, checksums and required notices.
- GHCR: runtime/companion images referenced by immutable registry digest.

Installing a newer CLI supplies newer recipes. Each recipe still selects an exact
runtime; startup never resolves “latest.” Existing installations retain their
accepted settings and runtime. Explicit configuration changes preserve unrelated
native edits. The CLI package version and a runtime version need not be the same.

New installations copy their runtime definition and tools into their own `runtime/`
directory and retain selected pack files under `state/pack-sources/`. Removing the
checkout, an npm cache entry or an older CLI package does not remove those files.
Downloads are bounded, checked before becoming executable inputs, and reused on
subsequent configuration. Corrupt retained tools fail verification rather than being
silently replaced. Docker verifies image digests. No start command resolves latest.

## Build and publish

[Build release candidate](../.github/workflows/build-release.yml) is manually dispatched
with an exact version, such as `0.1.0-alpha.1`. It:

1. Runs checks and tests the compiled operator outside the checkout on macOS arm64.
2. Builds the pinned OpenClaw source and ClawScarf images on Linux arm64 and x86-64,
   checks runtime capabilities and the Chromium sandbox, then starts a protected
   installation with private LiteLLM networking and verifies stop/start retention.
   It publishes image indexes containing both architectures to GHCR.
3. Downloads checksum-pinned OpenShell tools, records the image digests, and assembles
   one runtime archive per host platform, individual executable assets, npm CLI,
   checksums and notices.
4. Installs the resulting npm archive into a temporary prefix and checks its CLI/catalog.

The [image builder](../scripts/release/build-images.sh) and
[candidate assembler](../scripts/release/candidate.ts) contain the build commands;
GitHub Actions orchestrates the build and supplies registry credentials. Image builds
and Linux installation checks use Depot ARM64/x86-64 runners; macOS checks and packaging
use GitHub-hosted runners. The Depot Managed Runners app connects the ClawScarf organization
to the RAW Labs Depot organization. The source recipe pins the development
runtime. Packaging resolves that same runtime to the candidate's immutable definition;
it does not make recipes select latest. The first release uses the same CLI/runtime
version. Recipe versions remain independent; bump them when defaults, pack selection
or the selected runtime changes. Published definitions must not be overwritten.

The `release-candidate` Actions artifact is the reviewable output. Download it and test
a fresh supported installation, administrator login, real inference and stop/start
before publication. GitHub's macOS runner does not provide our Docker Desktop journey;
its packaging checks alone do not establish that journey. The browser-selection bug
remains a separate, explicit limit; the Team server recipe leaves browser disabled.

[Publish release candidate](../.github/workflows/publish-release.yml) accepts a successful
build run from `main`. It checks the source commit and artifact checksums, creates the
GitHub Release and publishes the already-built npm tarball. It never rebuilds images
or packages. Prereleases use npm's `next` tag; stable versions use `latest`. Repeating
a GitHub upload is allowed only when the existing checksums match exactly.

Repository setup:

- GHCR image packages must be publicly readable; a private candidate digest is not
  usable by an unauthenticated installer. The build uses GitHub's scoped job token.
- The GitHub `release` environment restricts deployment to `main`. The npm
  organization `@clawscarf` owns the public `@clawscarf/cli` package.
- npm trusted publishing is configured for repository `clawscarf/clawscarf`, workflow
  [publish-release.yml](../.github/workflows/publish-release.yml), environment `release`.
  The first tested tarball was published using the owner's authenticated npm CLI because
  npm requires a package to exist before configuring trust. Subsequent publication
  uses the workflow's short-lived identity rather than a stored npm token. That next
  workflow publication has not yet been exercised.
- Transitive notices/source review remains open in [TODO.md](../TODO.md).
  Debian copyright files remain in the images; runtime assets include upstream notices
  and the image build exports its network-tool sources. Those files are not a claim of
  a completed license audit. Pinned Debian packages still depend on mirror retention.

[Candidate 35524428880](https://github.com/clawscarf/clawscarf/actions/runs/35524428880)
passed its checks, compiled archive test and all eight image builds. The same artifacts
are available in the [0.1.0-alpha.1 GitHub prerelease](https://github.com/clawscarf/clawscarf/releases/tag/v0.1.0-alpha.1).
The identical CLI tarball is published as `@clawscarf/cli@0.1.0-alpha.1`, tagged `next`.
All eight GHCR images were verified anonymously readable by digest. The packaged CLI
passed fresh setup on the development Mac, staging hosted administrator login, real
GPT-6 Astra inference and stop/start with retained chat history. Published tool URLs
passed download and SHA-256 verification. Disposable installation containers, volumes
and networks were deleted afterward. This does not establish a newly provisioned
host, production first-time signup, Linux/WSL or changed-version upgrades.

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
