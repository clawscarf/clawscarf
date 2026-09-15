# Native runtime image

[Dockerfile](Dockerfile) extends the exact vanilla OpenClaw 2026.9.4 image with
immutable runtime dependencies. Customer configuration, identities, model keys,
connection credentials and writable state are initialized separately.
OpenShell owns the runtime container. Its outer Docker health check is disabled;
use the [native application probe](../openshell/README.md#application-transport)
inside the sandbox to check Gateway health.

```sh
docker build -f deploy/images/Dockerfile -t clawscarf-runtime:local .
```

The image includes:

- The built [Connections plugin](../../plugins/connections/README.md), at
  `/app/clawscarf/connections`.
- The native [account navigation plugin](../../plugins/access/README.md), at
  `/app/clawscarf/access`, enabled only by the standalone navigation preset.
- The [native launcher](../../runtime/README.md), at `/app/clawscarf/bin/openclaw`,
  used for Gateway startup and operator commands.
- The [fresh-volume initializer](../../runtime/initialize.ts), with its compiled entry
  point `/app/clawscarf/initialize-main.js`, used only by operator setup. It atomically
  initializes optional scoped model credentials with native state and preserves
  existing owned configuration and rejects foreign state.
- The [model configuration helper](../../runtime/models.ts), at
  `/app/clawscarf/models.ts`, for applying a scoped gateway credential and selected
  native model settings through authenticated operator access.
- The compiled [pack tool](../../packs/README.md) at `/app/clawscarf/bin/packs`
  and included research pack at `/app/clawscarf/packs/research-team`. Its
  [locked build dependencies](pack-tools/package-lock.json) are isolated from the
  runtime's one OpenClaw installation; only the compiled tool and production
  dependency closure ship.
- Official Codex and Lobster plugins at
  `/app/clawscarf/native-plugins/node_modules/@openclaw/codex` and
  `/app/clawscarf/native-plugins/node_modules/@openclaw/lobster`.
- Codex CLI 0.153.4 and its native platform payload, installed from the
  [dependency lock](native-plugins/package-lock.json). Its command is
  `node /app/clawscarf/native-plugins/node_modules/@openai/codex/bin/codex.js`.
- Debian Chromium and its sandbox helper, version 152.0.7977.82-1~deb12u1.
  The browser executable is `/usr/bin/chromium`.
- OpenShell's iproute2 and [Netfilter dependencies](network-tools/README.md),
  including unmodified nftables 1.1.3 built for the image's Debian 12 runtime.
  `SQLITE_TMPDIR=/tmp` keeps native
  SQLite temporary files within the permitted writable paths.

The pack executable is compiled from this repository's [CLI](../../scripts/packs.ts)
and [native lifecycle adapter](../../scripts/packs/lifecycle.ts). Its private
[build manifest](pack-tools/package.json) pins the existing Commander and Zod
dependencies for this image artifact; it is not another published application
package or an alternate OpenClaw installation.

Codex is not dependency-bundled upstream, so npm installs its complete locked
closure without lifecycle scripts. Lobster's official release contains its embedded
`@clawdbot/lobster` 2026.6.11 runtime and dependencies: the build verifies
[its release integrity](native-plugins/lobster.json) with
[the downloader](native-plugins/download.mjs), then extracts the archive verbatim.
Neither plugin needs a source patch. A symlink resolves their SDK imports to the
image's one OpenClaw installation; no second OpenClaw distribution is installed.
The recipe copies the root [license](../../LICENSE),
[third-party notices](../../THIRD_PARTY_NOTICES.md) and pinned upstream license/notice
files verbatim to `/usr/share/licenses/clawscarf`. Debian package copyright files
are retained. The added root notices have not yet been checked in a rebuilt image;
complete release license qualification remains open in the [plan](../../PLAN.md).

## Native registration

Installation configuration adds the two plugin directories to `plugins.load.paths`,
allows `codex`/`lobster` under `plugins.allow` when an allowlist is used, and enables
their `plugins.entries` entries. Set `codex.config.sessionCatalog.enabled: false`
inside its entry to omit local external-session browsing. Add `lobster` through
`tools.alsoAllow` for an authorized unsandboxed context. These are runtime presets,
not image mutations; preserve subsequent administrator changes.

Lobster runs in the Gateway process and can execute shell pipeline steps with its
environment. Its official factory returns no tool for a sandboxed agent context.
Installing the package does not make it a sandboxed worker tool or establish
per-member shell isolation. Do not bypass that native restriction.

For a browser profile, configure `browser.headless: true`,
`browser.noSandbox: false`, `browser.executablePath: /usr/bin/chromium` and use
OpenClaw's dedicated managed profile. Browser execution remains separate from
Codex's permissions and from native tool sandbox placement.

## Verified limits

The image built on Linux arm64. On the current pinned OpenShell Docker driver and
[policy](../openshell/policy.yaml), native plugin discovery loads both exact
versions; Codex CLI reports 0.153.4 and a Lobster local deterministic pipeline
returns its expected JSON. Those checks are reproduced by
[the capability probe](../../tests/runtime/capabilities.mjs).
Codex model execution and its filesystem/network isolation still require runtime
qualification; CLI startup is not evidence of those properties.

Chromium is installed but does **not** launch under that policy: `no_new_privs`
prevents its setuid sandbox and user-namespace creation is denied. Keep the browser
sandbox enabled. A supported browser placement or namespace configuration must be
qualified before advertising browser automation; this image does not silently
fall back to `--no-sandbox`.

The baseline is adapted from the Raw Labs pilot's
[Codex runtime helper](https://github.com/raw-labs/claw/blob/45d6b16b8c2d062141d70152e36ad9195846cfb6/scripts/install-codex-runtime-artifacts.sh)
and [browser runtime helper](https://github.com/raw-labs/claw/blob/45d6b16b8c2d062141d70152e36ad9195846cfb6/scripts/install-browser-runtime.sh)
(source reference only; the pilot is not acceptance evidence for this image).
Their root-owned binary copy and browser-skill mirror address pilot-specific
permission paths and are not automatically copied into this image.
