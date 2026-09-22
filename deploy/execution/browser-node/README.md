# Native browser controller

The [local operator](../../deployment/README.md#shared-browser) prepares, enrolls,
starts and stops this optional controller. This guide owns native enrollment,
controller policy and [current integration limits](#verified-release-limits).

This optional image runs OpenClaw's headless node as a trusted browser
controller **outside OpenShell**. The team runtime retains OpenShell. Chromium runs separately with its own sandbox and network boundary.
This component does not run team shell commands or hold administrator credentials.
It is not a replacement Gateway, browser server or per-person sandbox.

## Image and immutable configuration

```sh
# Reuse $base from the patched source build in deploy/images/README.md.
docker build --build-arg OPENCLAW_IMAGE="$base" \
  -f deploy/execution/browser-node/Dockerfile -t clawscarf-browser-node:local .
CLAWSCARF_TEST_BROWSER_NODE_IMAGE=clawscarf-browser-node:local \
  node --import tsx --test tests/runtime/browser-node*.test.ts
```

The [Dockerfile](Dockerfile) consumes the same [patched OpenClaw source image](../../images/README.md)
as the Gateway, including [shared artifact support](../../../runtime/openclaw/patches/browser-shared-artifacts.prompt.md).
It adds configuration validation and a native CLI launcher; it installs no additional
plugins, browser binary or package dependencies. Preparation and startup reject
controller images without the shared-artifact packaging contract.

The composition uses [browserNodeConfiguration](configuration.ts) to generate
`/configuration/openclaw.json`, mounted **read-only**, mode `0600`, readable by
UID 1000. The authenticated CDP URL is private configuration. Startup rejects
extra or weakened settings. Private inputs are opened without following symlinks
and must be regular, single-link, UID-owned files with no group/other permissions.
Reads are bounded to 64 KiB for configuration and 16 KiB for pairing codes; startup
errors omit private input and parser causes. The fixed native settings include:

- `tools.exec.mode: deny`, regardless of mutable native execution approvals.
- Disabled worker hosting, Claude agent runs, skill hosting and desktop hosting.
- Only the bundled browser plugin; no configured MCP servers or agent overrides.
- Only the `team` remote CDP profile, with `attachOnly: true` and an exact control
  hostname exception. Native page-navigation SSRF checks remain enabled.

Native browser proxy rejects persistent profile mutations and host-local profile
imports. Its upload owner confines files to generated staging directories. The
node command manifest is broader than browser commands: native exec-approval,
directory-listing and upload commands still exist. This image relies on immutable
local execution denial and configuration, not on hiding that command inventory.

Run as UID/GID 1000 with read-only root, all capabilities dropped,
`no-new-privileges`, init, bounded memory/PIDs and a private `/tmp` tmpfs. Mount a
private writable `/state` volume owned by UID 1000; it contains native device
identity, device token and browser-control state. Mount no team runtime files,
controller sockets, host directories or shared provider credentials. Configuration
and application files must never be writable by the node. A hostile container
operator can replace those mounts or this image and is outside this boundary.

## File transfers

Uploads use OpenClaw's existing staging workflow. Copy the selected workspace file
into the Gateway's native inbound media directory, then pass that staged path to
the browser upload action. Arbitrary workspace paths are deliberately rejected.
The native proxy sends file bytes to a private staging directory on the controller;
remote Chromium receives the contents without a workspace mount.

For downloads, only Chromium and the controller share `/browser-artifacts`, a
64 MiB tmpfs volume. The controller sets `OPENCLAW_BROWSER_SHARED_ARTIFACTS_DIR`
to that path. Each Playwright connection gets its own directory; native output
handling reads completed artifacts with bounded, link-rejecting filesystem access
and sends the bytes through the existing node proxy. The Gateway saves them in
its native browser media directory and returns that local path. Copy the result
into the desired workspace location when needed.

Native proxy limits remain 10 MiB per file and 16 MiB total per operation. Consumed
artifacts are removed; connection failure and disconnect remove their directories.
An unclean controller exit can leave artifacts until both containers stop and the
tmpfs unmounts. Storage exhaustion fails visibly. Profiles, credentials, configuration,
the team workspace and each container's `/tmp` remain separate.

## Pairing and connection

Native enrollment supports two verified issuance paths: an authenticated administrator
can call `device.pair.setupCode` with `bootstrapProfile: "node"`, or an
operator-owned local process can call the public `openclaw/plugin-sdk/device-bootstrap`
export `issueDeviceBootstrapToken` with the Gateway's actual state directory and
`profile: { roles: ["node"], scopes: [] }`. The latter does not need a browser login,
proxy identity or shared Gateway password. It needs installation-owner access to the
Gateway state, outside agent-controlled execution. The live trial used UID 1000,
`HOME=/home/node`, `SQLITE_TMPDIR=/tmp` and `baseDir: "/home/node/.openclaw"`.
The [operator helper](operator.ts) uses this local SDK path during initial startup.

The native setup-code payload carries the private Gateway URL and the scoped bootstrap
token. Mount its one-use code at `/configuration/pairing-code`, read-only and mode
`0600`, for initial enrollment. The node connects with role `node` and no operator
scopes. The launcher reads the code privately and invokes the package's exported
`runLegacyCliEntry` in-process; the code does not enter OS process arguments.
The pinned package exports its root at `/app/dist/index.js`; the launcher uses
that public entry. No hashed private bundle entry is used by production code.

The operator removes the pairing-code file after confirmed enrollment. Subsequent starts retain `/state`
and use the native paired device credential. Lost state requires a new scoped
pairing; never replace it with a shared Gateway password or administrator token.
Use native `node.pair.remove` to revoke and disconnect the node.

| Environment                                 | Meaning                                                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAWSCARF_BROWSER_NODE_GATEWAY_URL`        | Required private `wss://` Gateway endpoint, optionally with a context path; no URL credentials.                                               |
| `CLAWSCARF_BROWSER_NODE_TLS_FINGERPRINT`    | Optional native SHA-256 certificate pin.                                                                                                      |
| `CLAWSCARF_BROWSER_NODE_NAME`               | Native node display name; defaults to `ClawScarf browser`.                                                                                    |
| `CLAWSCARF_BROWSER_NODE_ALLOW_PRIVATE_WS=1` | Explicitly permits native plaintext WS over a separately protected private transport. It is not TLS and must not be used for public exposure. |

Set native `gateway.nodes.pairing.autoApproveLocal: false` and no trusted-CIDR
auto-approval. Scoped bootstrap approval remains explicit. The composition pins
native `gateway.nodes.browser` routing to this paired node so its absence cannot
silently select another browser host.

## Ingress and network contract

There is no native node-only Gateway listener. The composition must provide a
private machine ingress reachable only by this controller, forwarding vanilla
WebSockets without injecting a user identity. Strip caller-supplied trusted-user
and forwarding headers; any proxy attribution added by the ingress must reflect
the actual trusted transport. Never expose raw Gateway access publicly alongside
session-protected browser access. Gateway and Chromium must not be
able to connect to that machine ingress.

The node needs authenticated CDP and DNS for native public-URL preflight, not
arbitrary outbound TCP. The [DNS owner](../dns/README.md) defines its resolver;
the [network owner](../network/README.md) defines private ingress and Chromium egress.

## Verification

The [image regression](../../../tests/runtime/browser-node-image.test.ts) invokes
native command owners: immutable shell denial survives permissive native execution
approvals, uploads cannot replace configuration, and arbitrary MCP destinations are
rejected. It captures only RPC transport; it does not establish a live model journey.
The [current integration limits](#verified-release-limits) cover that separate boundary.

## Operator lifecycle

[Preparation](../../../scripts/deployment/browser-node.ts) creates owned node/configuration
volumes, a private TLS certificate and fixed network files. The node receives a separate
internal machine network for its Gateway ingress and DNS resolver, plus Chromium's
isolated CDP network. No node/ingress/DNS ports are published. The ingress and resolver
bind only their reserved machine addresses; their second network supplies upstream
connectivity, not a public listener. The certificate is pinned and checked on startup;
expired or changed material fails visibly rather than being silently replaced.

[Startup](../../../scripts/deployment/browser-node-pairing.ts) verifies the owned Gateway
binding, records pairing intent and issues one node-only bootstrap. It waits for the
public SDK's admitted node record and a connection timestamp from the current container
start. On success it records the device ID privately and removes the bootstrap file.
Restarts require that same admitted device; revocation, lost identity or uncertain
initial enrollment never triggers automatic re-pairing. Changed/ambiguous identity,
container exit and readiness timeout fail visibly, with retained state for inspection.
No user login, shared Gateway password or administrator credential authorizes the node.
Compose owns all three services; the CLI stops them before the Gateway.

## Upstream browser routing bug

The [browser routing intent](../../../runtime/openclaw/patches/browser-routing-guidance.prompt.md)
owns the incorrect default guidance, its correction and preserved routing semantics.
The [patch workflow](../../../runtime/openclaw/README.md) owns its maintenance;
[release provenance](../../../release/README.md#release-evidence) establishes which
candidate includes it. A guidance change does not change permissions or file transport.

## Verified release limits

Browser use is administrator-only: OpenClaw requires `operator.admin` for
`browser.request` and node browser proxy commands. This is the supported native
permission boundary. The [native tool regression](../../../tests/access/execution-live.test.ts)
expects member denial and administrator browsing without routing hints.

The [file-transfer regression](../../../tests/runtime/browser-transfer.test.ts) runs
real Chromium with its sandbox and a packaged controller in separate containers.
It exercises the native Gateway/controller file handlers with a fixture replacing
only node RPC transport: exact staged upload bytes, browser downloads persisted
back to the Gateway and copied into its workspace, restart cleanup and missing-mount
failure. It uses synthetic data and no model or existing installation. The release
builder runs it on both Linux image architectures; that is separate from qualifying
a standalone Linux installation.
The regression passed locally on macOS ARM64/Docker Desktop with newly built images.

The shared-artifact fix requires newly built controller images and updated operator
wiring. Source and local image checks do not update published runtime definitions.
Previously verified alpha.4 administrator browsing worked, but its downloads failed
with `download.saveAs: ENOENT`; those released images do not include this fix.
The Team server recipe remains disabled by default. [TODO.md](../../../TODO.md#browser)
tracks remaining released-installation qualification. [Release evidence](../../../release/README.md#release-evidence)
owns publication status, and the [network regression](../network/README.md#build-and-test)
owns destination restrictions.

Run the file-transfer regression against newly built images:

```sh
CLAWSCARF_TEST_BROWSER_IMAGE=clawscarf-browser:local \
  CLAWSCARF_TEST_BROWSER_NODE_IMAGE=clawscarf-browser-node:local \
  node --import tsx --test tests/runtime/browser-transfer.test.ts
```

Pinned upstream sources:

- [Node CLI and lifecycle entry](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/cli/node-cli/register.ts)
  and [public package entry](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/index.ts).
- [Public device-bootstrap SDK](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/plugin-sdk/device-bootstrap.ts)
  and [native issuance](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/infra/device-bootstrap.ts).
- [Trusted-proxy attribution](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/ingress-attribution.ts)
  and [authentication](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/auth.ts).
- [Browser target guidance](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/extensions/browser/src/browser-tool.ts),
  [node routing](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/extensions/browser/src/browser-tool.routing.ts)
  and [agent sandbox browser policy](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/agents/agent-tools.ts).
- [Native node execution](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/node-host/invoke-system-run.ts)
  and [browser proxy](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/extensions/browser/src/node-host/invoke-browser.ts).

ClawScarf's added files use this repository's MIT license. The upstream image
retains OpenClaw and dependency notices; release-wide transitive license review
remains owned by the release process. Native changes are maintained through the
[ordered patch series](../../../runtime/openclaw/README.md).
