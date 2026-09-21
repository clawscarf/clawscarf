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
- GitHub Releases: standalone CLI archives with a private Node runtime and installed
  dependencies, an installer, runtime tool archives, checksums, required notices and
  the OpenClaw source provenance and patch series used by the image build.
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
2. Reconstructs OpenClaw from the pinned upstream commit and the ordered
   [patch series](../runtime/openclaw/README.md), verifies the resulting source tree,
   then builds ClawScarf images on Linux arm64 and x86-64,
   checks runtime capabilities and the Chromium sandbox, then starts a protected
   installation with private LiteLLM networking, exercises native administrator
   access through the companion, and verifies stop/start retention.
   Both architectures must report identical OpenClaw source provenance and patch
   archives before it publishes image indexes containing both architectures to GHCR.
3. Downloads checksum-pinned OpenShell tools, records the image digests, and assembles
   one runtime archive per host platform, individual executable assets, npm CLI,
   checksums and notices. Candidate assembly verifies the image builds' patch archive
   and provenance against this checkout before including them in the release.
4. Installs the resulting npm archive into a temporary prefix and checks its CLI/catalog.
5. Builds standalone CLI archives on macOS ARM64 and Linux ARM64/x86-64 using the
   same npm payload and frozen production dependency lockfile. Downloads Node using
   the checksums in [components.json](components.json), retains its license, and
   tests the installer and packaged CLI with system Node deliberately unavailable.
   Only after all three platform checks pass does it assemble `release-candidate`.

[Standalone packaging](../scripts/release/standalone.ts) adds a private Node executable
and a small launcher; it does not change the CLI implementation. The
[installer](install.sh) is versioned with each release and downloads only that
version's archive, verifies SHA-256, and installs under `~/.local` by default.
`--prefix` selects another absolute directory. It never installs a host service,
changes system Node, edits shell profiles or needs sudo. To upgrade the CLI, run
the newer release's installer; it switches the command and retains the old version.
Runtime upgrades and installation data are separate from CLI installation.

The [image builder](../scripts/release/build-images.sh) and
[candidate assembler](../scripts/release/candidate.ts) contain the build commands;
GitHub Actions orchestrates the build and supplies registry credentials. Image builds
and Linux installation checks use Depot ARM64/x86-64 runners; macOS checks and packaging
use GitHub-hosted runners. The Depot Managed Runners app connects the ClawScarf organization
to the RAW Labs Depot organization. The image job installs Docker 29.5.3 on its
disposable runner for the network features required by installations.
The generated source-provenance JSON records the upstream commit, reconstructed commit, source tree,
ordered patch and intent hashes, and the complete patch-set digest.
`openclaw-patches.tgz` contains the exact `series`, patches and their regeneration
instructions. Both files are checksummed candidate assets and included in each runtime
archive. The runtime definition's `sourceRevision` still identifies the ClawScarf
commit, which owns those inputs; there is no second moving OpenClaw release branch.
This provenance describes the Gateway source build; the separate browser-node image
retains its upstream published image pin.
See the [patch workflow](../runtime/openclaw/README.md) for editing and upgrading them.
The source recipe pins the development
runtime. Packaging resolves that same runtime to the candidate's immutable definition;
it does not make recipes select latest. The first release uses the same CLI/runtime
version. Recipe versions remain independent; bump them when defaults, pack selection
or the selected runtime changes. Published definitions must not be overwritten.

The `release-candidate` Actions artifact is the reviewable output. Download it and test
a fresh supported installation, administrator login, real inference and stop/start
before publication. GitHub's macOS runner does not provide our Docker Desktop journey;
its packaging checks alone do not establish that journey. Model-selected browsing
through the patched release images still needs qualification; the Team server recipe
leaves browser disabled.

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
  Publication uses the workflow's short-lived identity rather than a stored npm token.
- Transitive notices/source review remains open in [TODO.md](../TODO.md).
  Debian copyright files remain in the images; runtime assets include upstream notices
  and the image build exports its network-tool sources. Those files are not a claim of
  a completed license audit. Pinned Debian packages still depend on mirror retention.

[0.1.0-alpha.4](https://github.com/clawscarf/clawscarf/releases/tag/v0.1.0-alpha.4)
is the first published candidate built from the ordered OpenClaw patch series. Its
[candidate build](https://github.com/clawscarf/clawscarf/actions/runs/35573534670)
passed full checks, all eight image builds on both architectures, exact source/patch
agreement, npm archive installation and standalone installation without system Node
on all three host platforms. Published assets include the verified source provenance
and patch archive; all image indexes are anonymously readable.
The public macOS installer also passed checksum verification and CLI/catalog loading
with system Node unavailable.

Both Linux architectures passed protected runtime startup, native WebSocket forwarding,
authenticated native administrator access through the companion, private model TLS,
retained stop/start and deletion on Docker 29.5.3. A fresh macOS Docker Desktop fixture
using the candidate package and images passed signed OIDC administrator login with a
disposable issuer, native People access, real GPT-6 Astra chat and retained files after
restart. Test containers, volumes and networks were deleted afterward.

The exact ARM64 runtime image also passed disabled marketplace CLI/RPC checks,
installed-inventory access and a zero-request ClawHub trap. Its Browser registration
advertised configured-node, disabled-node and sandbox priorities correctly. These
checks do not qualify model-selected browsing; the recipe still leaves browser off
and does not yet disable the marketplace.

Staging hosted administrator login and packaged interactive setup previously passed
on macOS with alpha.1. Hosted login and real provider inference on Linux, actual
Windows/WSL2 installation, production first-time signup and changed-version upgrades
remain unverified; see [TODO.md](../TODO.md).

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
