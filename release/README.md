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

Use the [installation guide](../deploy/deployment/installation.md) for published
CLI installation, platform requirements and runtime downloads. Use the
[development command](../scripts/README.md#development-command) for this checkout.

The tracked [development runtime](../runtime/releases/0.1.0-dev.json) is an input
for a prepared development environment, not a clean-machine release. Its exact
images and executable paths are data in that definition. Packaging resolves those
inputs to immutable candidate artifacts; runtime startup never selects latest.

## Publishing structure

Release candidates contain:

- npm `@clawscarf/cli`: compiled CLI, recipes, pack files, model catalog and runtime
  definitions. No Docker images or large OpenShell executables in npm.
- GitHub Releases: standalone CLI archives with a private Node runtime and installed
  dependencies, an installer, runtime tool archives, checksums, required notices and
  the OpenClaw source provenance and patch series used by the image build.
- GHCR: runtime/companion images referenced by immutable registry digest.

The [installation guide](../deploy/deployment/installation.md#change-an-existing-installation)
owns retained configuration and acquisition behavior. CLI, recipe and runtime
versions are independent; recipe versioning belongs to [recipes](../recipes/README.md).

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
[installer](install.sh) is versioned with the release and verifies its archive.
Its user-facing options and upgrade behavior belong to the
[installation guide](../deploy/deployment/installation.md); archive layouts belong to
[operator packaging](operator.md).

The [image builder](../scripts/release/build-images.sh) and
[candidate assembler](../scripts/release/candidate.ts) contain the build commands;
GitHub Actions orchestrates the build and supplies registry credentials. Image builds
and Linux installation checks use Depot ARM64/x86-64 runners; macOS checks and packaging
use GitHub-hosted runners. The Depot Managed Runners app connects the ClawScarf organization
to the RAW Labs Depot organization. The image job installs Docker 29.5.3 on its
disposable runner for the network features required by installations.
The [patch guide](../runtime/openclaw/README.md#release-and-verification-boundaries)
owns source identity and reconstruction. Candidate assembly packages
[openclaw-source.json and openclaw-patches.tgz](../scripts/release/candidate.ts)
with checksums; each runtime archive includes both. The runtime definition's `sourceRevision`
identifies the ClawScarf commit that owns those inputs.
The source recipe pins the development
runtime. Packaging resolves that same runtime to the candidate's immutable definition;
it does not make recipes select latest. Published definitions must not be overwritten.

The `release-candidate` Actions artifact is the reviewable output. Download it and test
a fresh supported installation, administrator login, real inference and stop/start
before publication. GitHub's macOS runner does not provide our Docker Desktop journey;
its packaging checks alone do not establish that journey. Check the owning component
limitations before claiming support for optional capabilities.

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

## Release evidence

[GitHub Releases](https://github.com/clawscarf/clawscarf/releases) owns published
versions, release notes and checksummed assets. The linked candidate CI run owns its
build/test results. Inspect the selected release's runtime definition and
OpenClaw source provenance to establish what actually shipped; current source docs are
not evidence that a setting or patch is present in an older installation.

Keep release-specific acceptance logs/screenshots in CI or ignored local artifacts,
with the tested revision/image, platform and actual outcomes. Promote only the tested
candidate; publishing reuses its bytes. Do not maintain a second release journal in
component READMEs. Current capability limits remain with their owners:
[browser integration](../deploy/execution/browser-node/README.md#verified-release-limits),
[runtime boundary](../deploy/openshell/README.md), [models](../deploy/models/README.md),
[Access](../services/access/README.md) and [Connections](../plugins/connections/README.md).
Open acceptance requirements live only in [TODO.md](../TODO.md).

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
