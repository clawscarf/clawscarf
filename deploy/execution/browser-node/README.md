# Native browser controller

**Operator integration is unfinished.** A disposable private TLS/DNS assembly passed
native administrator/member browsing, retained device identity and revocation after
restart. Initial authenticated enrollment and retained browser-profile acceptance
remain in [TODO.md](../../../TODO.md). There is no automatic operator startup path.

This optional image runs vanilla OpenClaw's headless node as a trusted browser
controller **outside OpenShell**. The Gateway and SSH execution worker retain
OpenShell. Chromium runs separately with its own sandbox and network boundary.
This component does not run team shell commands or hold administrator credentials.
It is not a replacement Gateway, browser server or per-person sandbox.

## Image and immutable configuration

```sh
docker build -f deploy/execution/browser-node/Dockerfile -t clawscarf-browser-node:local .
CLAWSCARF_TEST_BROWSER_NODE_IMAGE=clawscarf-browser-node:local \
  node --import tsx --test tests/runtime/browser-node*.test.ts
```

The recipe derives from the same digest-pinned vanilla OpenClaw 2026.9.4 image as
the Gateway. It adds only configuration validation and a small native CLI launcher;
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
identity, device token and browser-control state. Mount no Gateway/worker files,
controller sockets, host directories or shared provider credentials. Configuration
and application files must never be writable by the node. A hostile container
operator can replace those mounts or this image and is outside this boundary.

## Pairing and connection

The operator calls the native `device.pair.setupCode` RPC with
`bootstrapProfile: "node"`, `includeQr: false`, and the private Gateway URL. Mount
its one-use code at `/configuration/pairing-code`, read-only and mode `0600`, for
initial enrollment. The native node connects with role `node` and no operator
scopes. The launcher reads the code privately and invokes the package's exported
`runLegacyCliEntry` in-process; the code does not enter OS process arguments.
The pinned package exports its root at `/app/dist/index.js`; the launcher uses
that public entry. No hashed private bundle entry is used by production code.

Remove the pairing-code mount after enrollment. Subsequent starts retain `/state`
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
session-protected browser access. Gateway, SSH worker and Chromium must not be
able to connect to that machine ingress.

The node needs authenticated CDP reachability and DNS resolution for native public
URL preflight. It does not need arbitrary outbound TCP. Docker internal-only DNS
failed public resolution on the tested Docker Desktop installation, so isolated
assembly needs an explicit reviewed DNS path. The separate
[browser network](../network/README.md) owns Chromium's public-web egress and
private-destination denial. This README is a composition contract, not a claim
that production node network isolation has been qualified.

## Verification and upstream ownership

The opt-in image regression invokes the pinned native command owner without
changing its authorization: even after native approvals become `full/off`, shell
execution is denied; uploads cannot replace config; unconfigured arbitrary MCP
server names/URLs are rejected. This focused test captures only the RPC transport.

A disposable assembly paired this image with a live OpenShell-contained Gateway
through the private TLS ingress, using its pinned certificate and scoped native
setup code. The node had no public TCP route; its private resolver handled public
URL preflight and Chromium retained its separate public-web proxy. The [native tool regression](../../../tests/access/execution-live.test.ts) requires
an explicitly selected browser node. Native member and administrator sessions
opened, snapshotted and closed their own public tabs
with `target=node`. Removing the one-use pairing file and restarting retained the
node identity. Native `node.pair.remove` disconnected it and restart did not restore
admission. The earlier paired trial also verified immutable execution denial and
private/loopback/metadata navigation denial. Test containers and pairings were removed.
These trials do not qualify normal operator startup, browser-profile persistence or
Linux-host deployment.

### Initial enrollment boundary

The successful trials obtained `device.pair.setupCode` through an authenticated
Access administrator. A fresh operator's direct localhost bootstrap attempt failed:
OpenClaw requires a non-loopback client attribution for trusted-proxy authentication,
even when the proxy itself may be loopback. Setting an invented forwarding address or
creating another administrator ingress is not an accepted workaround. The remaining
integration must use an authenticated Access session, coordinated with initial
administrator setup, before starting and pinning the browser node. No automatic
re-pair may undo native revocation. Prototype startup wiring is not in the shipped
operator.

Native agent routing has a separate usability limitation: its tool description says
`host` is the default even when `gateway.nodes.browser.node` is pinned. In a live
trial, the model explicitly selected `host` and hit the Gateway DNS denial. Explicit
`target=node` succeeded for both members and administrators. There is no native tool
or RPC rewrite in ClawScarf; operator integration must address this guidance without
weakening Gateway confinement.

Pinned upstream sources:

- [Node CLI and lifecycle entry](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/src/cli/node-cli/register.ts)
  and [public package entry](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/src/index.ts).
- [Trusted-proxy attribution](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/src/gateway/ingress-attribution.ts)
  and [authentication](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/src/gateway/auth.ts).
- [Browser target guidance](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/extensions/browser/src/browser-tool.ts)
  and [node routing](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/extensions/browser/src/browser-tool.routing.ts).
- [Native node execution](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/src/node-host/invoke-system-run.ts)
  and [browser proxy](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/extensions/browser/src/node-host/invoke-browser.ts).

ClawScarf's added files use this repository's MIT license. The upstream image
retains OpenClaw and dependency notices; release-wide transitive license review
remains owned by the release process. No native source is copied or patched here.
