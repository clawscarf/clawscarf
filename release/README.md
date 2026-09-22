# Runtime releases, recipes and packs

These have separate responsibilities:

| Definition      | Owns                                                                                             | Location                                        |
| --------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Runtime release | Exact software images, OpenShell executables, checksums and supported platforms                  | [runtime/current.json](../runtime/current.json) |
| Recipe          | A fixed runtime reference plus editable model, reasoning, resource, capability and pack defaults | [recipes](../recipes/README.md)                 |
| Pack            | Native agent, skill and workflow files with declared prerequisites                               | [packs](../packs/README.md)                     |

Several recipes can use the same runtime. A runtime contains no recipes, model
catalog or pack selections. Changing a recipe does not require rebuilding its runtime.
Recipes and packs ship with the CLI; there is no separate registry or dependency resolver.
The [model catalog](../deploy/models/catalog.json) is also a CLI asset. Recipe IDs select
catalog entries; model protocols and limits have one definition.

## Published and development use

Use the [installation guide](../deploy/deployment/installation.md) for published
CLI installation, platform requirements and runtime downloads. Use the
[development command](../scripts/README.md#development-command) for this checkout.

The tracked [current runtime](../runtime/current.json) selects a published release
by exact image digests and downloadable tool checksums. The development command
reads it from the checkout; it does not query a remote latest version or build images.
The `cloudBilling: true` manifest field declares companion and native plugin support
for Account billing and Cloud AI. Candidates built from this source declare it;
custom development manifests must declare it only with matching newly built images.
The installer refuses Cloud AI on earlier runtimes, while provider-key and existing
Connections setups keep their prior behavior. The currently published runtime pin
is unchanged by this source feature.
New installations retain their own copy. Updating this file or the CLI never changes
an existing installation's saved selection.

After publication, the workflow copies the verified release manifest into this file
and commits it to `main`. Pulling that commit updates the development command's
selection. [Promotion](../scripts/release/advance-runtime.ts) requires a newer version
and the same selection the candidate was built against; an identical repeat is a no-op.
A changed pin or concurrent Git update fails visibly instead of overwriting another
selection. The promotion job can be retried independently of publication. Repository
rules must permit the release workflow's bot to push this commit to `main`.

For experiments with locally built images/tools, create a separate runtime bundle
and custom recipe using [runtime assembly](#assemble-runtime-artifacts). The bundled
recipe uses the same published artifact format in development and installed CLIs.

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
Recipes reference the current manifest within their checkout or installed package.
Candidate packaging replaces that file only in the staged package with the newly
built manifest. It leaves source files untouched; publication advances the checkout
as described above. Published packages and release assets remain immutable.

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
A separate dependent job then advances the checkout's current runtime selection;
a failure there leaves the published release available and can be retried without
republishing npm or rebuilding artifacts.

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

## CLI telemetry destination

[telemetry.json](telemetry.json) is copied unchanged into the compiled operator,
npm CLI and standalone CLI payload. It selects the ClawScarf project in PostHog EU
using `host` (the HTTPS ingestion origin) and `projectToken` (the public `phc_`
project token). Setting the file to `null` disables reporting for that build.
Never put a personal or project-secret API key in this public file. A loopback
HTTP origin is accepted for local receiver tests only.

The [CLI telemetry guide](../deploy/deployment/installation.md#telemetry) owns event
fields, user opt-out, local identity and delivery limits. Destination changes need
a new CLI build/package; they do not change running team servers or cloud-service
configuration. Automated tests use local receivers. The destination project's
**Settings → Privacy → Discard client IP data** must stay enabled: a null `$ip`
property alone does not prevent PostHog from storing the connection IP. The CLI
also disables GeoIP enrichment. When changing destinations, verify that privacy
setting and confirm start/finish events and their properties in the target project
before publishing. An ingestion check does not establish CLI release publication.
