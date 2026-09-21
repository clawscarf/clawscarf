# Native browser controller

The [local operator](../../deployment/README.md#shared-browser) prepares, enrolls,
starts and stops this optional controller. Alpha.4 passes administrator model-selected
browsing, but member permissions and downloads still block default enablement; see
[verified release limits](#verified-release-limits). The Team server recipe leaves browser disabled.

This optional image runs vanilla OpenClaw's headless node as a trusted browser
controller **outside OpenShell**. The team runtime retains OpenShell. Chromium runs separately with its own sandbox and network boundary.
This component does not run team shell commands or hold administrator credentials.
It is not a replacement Gateway, browser server or per-person sandbox.

## Image and immutable configuration

```sh
docker build -f deploy/execution/browser-node/Dockerfile -t clawscarf-browser-node:local .
CLAWSCARF_TEST_BROWSER_NODE_IMAGE=clawscarf-browser-node:local \
  node --import tsx --test tests/runtime/browser-node*.test.ts
```

The recipe retains the digest-pinned published OpenClaw 2026.9.4 image for
the browser node. It adds only configuration validation and a small native CLI launcher;
it installs no plugins, browser binary or package dependencies.

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

The node needs authenticated CDP reachability and DNS resolution for native public
URL preflight. It does not need arbitrary outbound TCP. Docker internal-only DNS
failed public resolution on the tested Docker Desktop installation, so isolated
assembly needs an explicit reviewed DNS path. The separate
[browser network](../network/README.md) owns Chromium's public-web egress and
private-destination denial. This README is a composition contract, not a claim
that Linux or production deployment has been qualified.

## Verification and upstream ownership

The opt-in image regression invokes the pinned native command owner without
changing its authorization: even after native approvals become `full/off`, shell
execution is denied; uploads cannot replace config; unconfigured arbitrary MCP
server names/URLs are rejected. This focused test captures only the RPC transport.

A disposable assembly paired this image with a live OpenShell-contained Gateway
through the private TLS ingress, using its pinned certificate and scoped native
setup code. The node had no public TCP route; its private resolver handled public
URL preflight and Chromium retained its separate public-web proxy. That earlier
trial explicitly selected a browser node. Native member and administrator sessions
opened, snapshotted and closed their own public tabs
with `target=node`. Removing the one-use pairing file and restarting retained the
node identity. Native `node.pair.remove` disconnected it and restart did not restore
admission. The earlier paired trial also verified immutable execution denial and
private/loopback/metadata navigation denial. Test containers and pairings were removed.
These component trials do not qualify ordinary model-selected browser use or Linux-host deployment.

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

Fresh-stack automatic enrollment, administrator verification and native public navigation
passed using exact local images on macOS arm64/Docker Desktop. A full operator
stop/start retained both the admitted node identity and a browser profile cookie,
and native public navigation succeeded again. After native revocation, operator
startup refused to re-enroll the device and stopped its services with data retained.

## Upstream browser routing bug

The pinned upstream tool advertises `host` as the default even when an omitted
target selects the configured browser node. An explicit `host` bypasses that node.
The earlier live model trial selected `host` and hit Gateway DNS denial, whereas
explicit `target=node` succeeded for members and administrators.

ClawScarf now maintains the [browser routing guidance patch](../../../runtime/openclaw/patches/browser-routing-guidance.patch)
and its [regeneration instructions](../../../runtime/openclaw/patches/browser-routing-guidance.prompt.md).
It corrects both lazy registration and the direct tool description to recommend
omitting `target` and `node` for configured routing. Source regressions cover
configured auto/manual node routing, unavailable-node failure, explicit host
selection, sandbox precedence, blocked host/node control, disabled node routing
and tab-bound guidance. The routing implementation is unchanged.

The patch is published in ClawScarf alpha.4 and has not been submitted upstream.
It fixes routing guidance, not browser permissions or file transport. Upstream
submission remains an explicit owner decision.

The team runtime still denies Gateway public DNS/direct CDP; the browser node and
Chromium retain their separate networks. Explicit host selection remains explicit,
and an unavailable configured node still fails without host fallback. Sandbox
`allowHostControl: false` blocks both host and node browsing; it is not a node-only
selector. The current team preset disables the inner agent sandbox, so that
restriction does not block its configured node.

## Verified release limits

A disposable macOS ARM64/Docker Desktop installation using the exact alpha.4 images,
the current marketplace-disabled preset and real GPT-6 Astra inference verified:

- An administrator opened a public page, read its heading and closed its own tab.
  The prompt supplied no profile, target or node; the model used default routing.
- A member's first browser status call failed with `missing scope: operator.admin`.
  The pinned native policy explicitly requires administrator scope for `browser.request`
  and `node.invoke` browser proxy commands. The earlier explicit-node trials do not
  establish member support in this release.
- Uploading a workspace file succeeded after staging a copy in the native inbound
  media directory. The page read and displayed its exact bytes.
- Downloading failed with `download.saveAs: ENOENT`: the downloaded bytes existed in
  Chromium's temporary artifact directory, but that path was absent in the separate
  browser controller. No downloaded file reached the team workspace.
- Native requests rejected loopback, private and metadata destinations. Explicit host
  selection remained separate from the connected node; stopping the configured node
  caused requests to fail without host fallback. The released Chromium network
  regression also passed public HTTPS, destination denial and retained profile checks.

The [native tool regression](../../../tests/access/execution-live.test.ts) now requests
ordinary browsing without routing hints and checks actual tool results for both roles.
The Team server recipe keeps browser disabled until member permissions and download
transfer are fixed and qualified. These results do not qualify Linux browser deployment.
All disposable installation and network-test resources were removed.

[TODO.md](../../../TODO.md#browser-qualification) owns the remaining work.

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
remains owned by the release process. No native source is copied or patched here.
