# Native runtime image

[Dockerfile](Dockerfile) extends the OpenClaw source build selected by
[components.json](../../release/components.json) and the ordered
[patch series](../../runtime/openclaw/README.md), with immutable runtime dependencies.
Customer configuration, identities, model keys, connection credentials and writable
state are initialized separately. The browser-node controller consumes the same
patched source image. SDK package locks own separate package pins;
source/package versions are not interchangeable.
OpenShell owns the runtime container. Its outer Docker health check is disabled;
use the [native application probe](../openshell/README.md#application-transport)
inside the sandbox to check Gateway health.

```sh
node --import tsx scripts/openclaw-patches.ts prepare \
  --directory .local/openclaw-source --provenance .local/openclaw-source.json
revision="$(jq -er .revision .local/openclaw-source.json)"
tree="$(jq -er .tree .local/openclaw-source.json)"
base="clawscarf-openclaw:source-$tree"
plugins="$(jq -er '.bundledPlugins | join(",")' runtime/openclaw/inventory.json)"
skills="$(jq -er '.bundledSkills | join(",")' runtime/openclaw/inventory.json)"
docker build --build-arg GIT_COMMIT="$revision" \
  --build-arg "OPENCLAW_BUILD_TIMESTAMP=$(TZ=UTC git -C .local/openclaw-source show -s --date=format-local:%Y-%m-%dT%H:%M:%SZ --format=%cd HEAD)" \
  --build-arg "OPENCLAW_EXTENSIONS=$plugins" --build-arg OPENCLAW_EXTENSIONS_ONLY=1 \
  --build-arg "OPENCLAW_DOCKER_SKILLS=$skills" \
  -t "$base" .local/openclaw-source
docker build --build-arg OPENCLAW_IMAGE="$base" \
  -f deploy/images/Dockerfile -t clawscarf-runtime:local .
```

Use a new source directory. Preparation fails if a patch cannot apply or the result
differs from the patched Git tree pinned in [components.json](../../release/components.json).
The upstream Dockerfile builds Gateway, native UI and its dependencies from that
prepared source. Release manifests use the resulting exact runtime image ID/digest,
never the local build tag. The release builder also records source/patch hashes in
runtime image labels and publishes the corresponding source provenance and patch
archive; see [release assembly](../../release/README.md#build-and-publish).
These are reproducible source inputs, not a promise of bit-identical image output:
the upstream Dockerfile also resolves system packages at build time.

Built-in plugins and skills are selected by the
[distribution inventory](../../runtime/openclaw/inventory.json). The
[packaging patch](../../runtime/openclaw/patches/curated-image-inventory.prompt.md)
applies that selection before final image layers are copied. The release build runs
the [inventory check](../../tests/runtime/inventory.mjs) against each architecture:
source/compiled manifests, native plugin discovery and skill files must match.
This is image selection, not a runtime restriction on administrator additions.

Additional runtime components are:

- The built [Connections plugin](../../plugins/connections/README.md), at
  `/app/clawscarf/connections`. Its operator configuration helper resolves the
  OpenClaw SDK through a peer symlink to the image's single upstream installation.
- The native [Account and People plugin](../../plugins/access/README.md), at
  `/app/clawscarf/access`, enabled only by the standalone navigation preset. Its build
  includes the shared generated Access client; no external account-page redirect is
  packaged.
- The [native launcher](../../runtime/README.md), at `/app/clawscarf/bin/openclaw`,
  used for Gateway startup and operator commands.
- The [fresh-volume initializer](../../runtime/initialize.ts), with its compiled entry
  point `/app/clawscarf/initialize-main.js`, used only by operator setup. It atomically
  initializes optional scoped model/Connections credentials with native state,
  makes a fresh home owner-only (0700), preserves existing owned configuration and
  rejects foreign state. Repeating initialization does not repair retained permissions.
- The [browser-volume initializer](../../runtime/initialize-browser.ts), at
  `/app/clawscarf/initialize-browser-main.js`, used only on the separate owned
  browser volume. It retains profile state and verifies its private CDP identity.
- The stopped [Connections configuration helper](../../runtime/configure-connections.ts),
  at `/app/clawscarf/configure-connections-main.js`, and the launcher's scoped credential
  loader. The [local activation procedure](../deployment/README.md#activate-connections)
  owns their use; provider keys are never supplied to these helpers.
- The compiled [model configuration helper](../../runtime/models.ts), at
  `/app/clawscarf/models-main.js`, for applying a scoped gateway credential and selected
  native model settings through authenticated operator access.
- The compiled [pack tool](../../packs/README.md) at `/app/clawscarf/bin/packs`
  and included research pack at `/app/clawscarf/packs/research-team`. Its
  [locked build dependencies](pack-tools/package-lock.json) are isolated from the
  runtime's one OpenClaw installation; only the compiled tool and production
  dependency closure ship.
- Upstream's bundled Codex plugin and CLI at `/app/dist/extensions/codex`,
  supplied by the pinned source build with their native platform payload.
  Its command is `node /app/dist/extensions/codex/node_modules/@openai/codex/bin/codex.js`.
- The official Lobster plugin at
  `/app/clawscarf/native-plugins/node_modules/@openclaw/lobster`.
- Upstream's bundled `document-extract` plugin and its `clawpdf` dependency for
  native PDF extraction. They come from the pinned OpenClaw build; no separate
  `clawpdf` CLI installation is required. A native allowlist must include
  `document-extract` when PDF extraction is selected.
- Debian Python 3 for local code execution.
- Debian Chromium and its sandbox helper; exact packages are pinned in the Dockerfile.
  The browser executable is `/usr/bin/chromium`.
- OpenShell's iproute2 and [Netfilter dependencies](network-tools/README.md),
  including unmodified nftables built for the image's Debian runtime.
  `SQLITE_TMPDIR=/tmp` keeps native
  SQLite temporary files within the permitted writable paths.

The pack executable is compiled from this repository's [CLI](../../scripts/packs.ts)
and [native lifecycle adapter](../../scripts/packs/lifecycle.ts), including the shared
CLI output formatter. Like the installation CLI, it prints readable output by default;
operator callers request `--json`. Its private
[build manifest](pack-tools/package.json) pins the existing Commander and Zod
dependencies for this image artifact; it is not another published application
package or an alternate OpenClaw installation.

Codex uses the pinned upstream image's complete plugin-local runtime dependencies.
No extra Codex npm installation or explicit discovery path is needed. Lobster's
separate official release contains its embedded `@clawdbot/lobster`
runtime and dependencies: the build verifies
[its release integrity](native-plugins/lobster.json) with
[the downloader](native-plugins/download.mjs), then extracts the archive verbatim.
Lobster's SDK imports resolve through a symlink to the image's one OpenClaw
installation. Neither plugin needs an upstream source patch.
The recipe copies the root [license](../../LICENSE),
[third-party notices](../../THIRD_PARTY_NOTICES.md) and pinned upstream license/notice
files verbatim to `/usr/share/licenses/clawscarf`. Debian package copyright files
are retained. [Third-party notices](../../THIRD_PARTY_NOTICES.md) own attribution
and redistribution requirements.

## Native registration

Lobster is explicitly included in `plugins.load.paths`; Codex uses upstream
discovery and keeps its native bundled provenance. Both are allowed under `plugins.allow` when an
allowlist is used and enabled through `plugins.entries`. An explicit external
Codex path would override the bundled plugin and lose its reserved command and
native-compaction authority. Set `codex.config.sessionCatalog.enabled: false`
inside its entry to omit local external-session browsing. Add `lobster` through
`tools.alsoAllow` in the native local context, protected by outer OpenShell. These are runtime presets,
not image mutations; preserve subsequent administrator changes.

Lobster runs in the Gateway process; its shell pipeline children share the runtime
filesystem and inherit outer OpenShell restrictions. Inner OpenClaw sandboxing is
off in the fresh preset. Installing native plugins does not establish per-member
isolation. Python 3 is included in the runtime image for local code execution;
additional document CLIs/libraries belong in this image or a recipe-selected runtime
image, not a separate worker.
The image declares `io.clawscarf.execution-model=team-runtime`; preparation,
startup and doctor verify this packaging contract.

The selected [shared browser](../execution/browser/README.md) runs Chromium
outside this Gateway image with its sandbox intact. [Local setup](../deployment/README.md#shared-browser)
configures the native remote CDP profile, scoped network route and browser node. Browser execution remains separate from Codex permissions and native
shell placement. Installing Chromium in the Gateway image does not qualify
launching it inside OpenShell; see the limits below.

## Verified limits

The [capability probe](../../tests/runtime/capabilities.mjs) checks bundled Codex
provenance, runtime harness registration, the pinned CLI, and a deterministic Lobster
pipeline using temporary configuration and no model calls.
The probe captures the actual Responses request builder before HTTP and verifies that
optional tool arguments retain `strict: false` on our custom model route. It also
checks plugin disable/enable and skill eligibility using native CLI
commands against a temporary configuration. Run that image-only check with an exact
locally built image ID:

```sh
docker run --rm --network none --read-only --tmpfs /tmp:rw,size=256m \
  --entrypoint node \
  --mount "type=bind,source=$PWD/tests/runtime/capabilities.mjs,target=/tmp/capabilities.mjs,readonly" \
  sha256:REPLACE_WITH_RUNTIME_IMAGE_ID /tmp/capabilities.mjs
```

This command uses no existing installation state and makes no provider calls. It
does not run the OpenShell supervisor or qualify its execution boundary.
The [native runtime test](../openshell/README.md#repeatable-boundary-and-retention-check)
owns shared upload/file/shell/Lobster, PDF and outer-boundary acceptance with a
deterministic model fixture inside the real supervisor. CLI startup alone is not
model-driven execution or isolation evidence; consult [release evidence](../../release/README.md#release-evidence).

The [Connections image regression](../../tests/runtime/connections-image.test.ts)
exercises configuration and scoped credential/CA delivery through the real launcher,
native `connections_search` with agent context, and retained Gateway restart:

```sh
CLAWSCARF_TEST_CONNECTIONS_IMAGE=sha256:REPLACE_WITH_RUNTIME_IMAGE_ID \
  pnpm exec tsx --test tests/runtime/connections-image.test.ts
```

It uses a disposable tmpfs home and a controlled TLS broker inside a container with
networking disabled. Initialization runs as root; configuration and Gateway run as
UID 1000. It touches no existing installation, provider account or external service.
This qualifies image packaging, not the complete OpenShell/companion account journey.

Chromium is installed but does **not** launch under that policy: `no_new_privs`
prevents its setuid sandbox and user-namespace creation is denied. Keep the browser
sandbox enabled. Native browser integration and support limits belong to the
[browser-node owner](../execution/browser-node/README.md#verified-release-limits);
this image does not fall back to `--no-sandbox`.

The baseline is adapted from the Raw Labs pilot's
[Codex runtime helper](https://github.com/raw-labs/claw/blob/45d6b16b8c2d062141d70152e36ad9195846cfb6/scripts/install-codex-runtime-artifacts.sh)
and [browser runtime helper](https://github.com/raw-labs/claw/blob/45d6b16b8c2d062141d70152e36ad9195846cfb6/scripts/install-browser-runtime.sh)
(source reference only; the pilot is not acceptance evidence for this image).
Their root-owned binary copy and browser-skill mirror address pilot-specific
permission paths and are not automatically copied into this image.

## OpenShell forwarding image

Build the trusted forwarding client alongside the application images:

```sh
docker build -f deploy/images/openshell-client.Dockerfile -t clawscarf-openshell-client:dev .
docker image inspect clawscarf-openshell-client:dev --format '{{.Id}}'
```

Put that exact image ID in the development release's `images.openshellClient`.
The [forwarder Dockerfile](openshell-client.Dockerfile) selects the checksum-pinned
OpenShell Linux CLI, OpenSSH and full
`lsof` (BusyBox's implementation does not support OpenShell's port checks). It carries
no credentials. Compose mounts only the installation's controller client configuration.
The controller uses the upstream gateway image pinned in the [component manifest](../../release/components.json);
the team runtime remains a protected OpenShell container.
