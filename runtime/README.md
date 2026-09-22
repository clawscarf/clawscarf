# Native configuration

This guide owns the native preset and runtime helpers. The
[distribution guide](openclaw/README.md) owns source patch maintenance;
[the image guide](../deploy/images/README.md) owns packaged files.

[private-files.ts](private-files.ts) owns bounded private-file reads and staged directory publication. Runtime and browser initializers retain their own resume/identity policies; they share file ownership and publication mechanics.

[configuration.ts](configuration.ts) defines the fresh-install preset used internally by installation.
The input contains `agentName`, `publicOrigin`, `widgetOrigin` and the
exact `administratorIdentity` produced by the [access service](../services/access/README.md)
or a hosting platform's trusted ingress. The preset does not assign an identity
namespace or depend on either platform's database. The public origin configures both
browser admission and native OAuth callback/session/viewer link generation; widgets
retain their separate origin.
`agentName` initializes `agents.entries.main.name` and `identity.name` through native configuration.
`standaloneNavigation` defaults to true and enables the bundled native account/People
pages. A hosting platform supplying its own entry UI sets it to false.
Initialization refuses to overwrite existing configuration and validates with the pinned OpenClaw CLI
before launch; it is not a reconfiguration or migration command.

The preset is adapted from RawClaw's
[`runtime/openclaw/defaults.py`](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/runtime/openclaw/defaults.py).
It retains explicit initial identity, trusted ingress, disabled terminal/community
invite/marketplace/external session catalogs, restricted Codex dynamic tools, separate widget
origin, disabled elevated execution and Chrome's sandbox.
The OpenShell transport replaces the fixed Hetzner bridge addresses; the donor's
rootless-Docker UID mapping does not apply. The preset sets
`agents.defaults.sandbox.mode: off`, member `sandbox: inherit` and
`tools.exec.host: gateway`, while keeping native `exec.mode: auto` approvals.
OpenShell still encloses the whole runtime. See the [security contract](../README.md)
for the resulting team trust boundary. Pending identities still have no agent/tool access.

The [image guide](../deploy/images/README.md#native-registration) owns native plugin
packaging and registration. Browser integration and its limits belong to the
[browser-node guide](../deploy/execution/browser-node/README.md#verified-release-limits).
Connections starts disabled in the native preset; selecting that capability enables
its plugin. Native administrators can deliberately change application settings.
The preset sets `gateway.cliAgents.enabled: false` to disable catalog-backed CLI
agents while retaining the native Codex agent plugin.

The preset disables background checks with `update.checkOnStart: false` and
automatic updates with `update.auto.enabled: false`. The runtime launcher sets
`OPENCLAW_NO_SELF_UPDATE=1`; ClawScarf releases supply the bundled OpenClaw.
The [update patch](openclaw/patches/disable-server-updates.prompt.md) owns the
manual-update restriction and UI removal; administrator-installed extension updates
remain available. The [Labs patch](openclaw/patches/remove-labs.prompt.md) removes
the experiments page while preserving custom plugin UI.

Members use `gateway.roles.definitions.member.sessions.others: "view"`: they can
read other people's ordinary sessions, while explicit native session membership
permits participation. Their own sessions remain writable; native draft and
incognito restrictions still apply. Home keeps OpenClaw's shared main-session
destination: if someone else owns it, a member can read it and either create their
own session or be explicitly added to participate. This preset does not create
private Home sessions or grant team-wide write access.

[openclaw.sh](openclaw.sh) is the image's `/app/clawscarf/bin/openclaw` launcher.
Use it for the canonical Gateway command and operator CLI execution. It sets the
persistent home/state defaults and SQLite temporary directory. For Gateway startup it
creates and enters `/home/node/.openclaw/workspace`, matching the default native
agent workspace on the retained home volume, before invoking the
OpenClaw executable built from the selected source and maintained patches. OpenShell operator execution does not inherit all
Docker image environment variables, so image `ENV` alone is insufficient.
The launcher also supplies OpenClaw's supported local password authentication for
native CLI calls, including Claws automation cleanup. On first Gateway startup it
creates `clawscarf-gateway-password` in the private retained state directory; CLI
calls and later starts reuse it. Invalid or exposed material fails closed. It is
passed through the process environment, never command arguments or Docker settings.
Explicit native password configuration remains authoritative. This is local runtime
operator authority, not a person or another login route: upstream rejects password
fallback for forwarded traffic, and Access still gates external admission/revocation.
Execution inside the team runtime already holds Gateway authority.

When model setup installs a private gateway's public CA, the launcher adds it to
Node's process-wide trust through `NODE_EXTRA_CA_CERTS`. [trust.ts](trust.ts) combines
optional model and Connections CAs with any inherited controller/operator CA
bundle; none replaces another. It publishes immutable content-addressed public bundles before Node starts,
and rejects unreadable inputs or mismatched existing contents. Runtime-owned CA files use the same bounded, descriptor-based private-file checks as credentials. CA changes require a
Gateway restart; no certificate verification is disabled. Model tokens remain separate
private native file secrets.

When OpenShell supplies `HTTPS_PROXY`, the launcher selects it through OpenClaw’s
native `OPENCLAW_PROXY_URL` and enables Node’s `NODE_USE_ENV_PROXY`. Native web
fetches and proxy-aware child tools therefore use the controller’s network policy;
this does not grant direct DNS or arbitrary outbound sockets. The
[network boundary](../deploy/openshell/README.md#public-web-access) owns those rules.

For an explicitly configured Connections runtime, the launcher reads
`/home/node/.openclaw/clawscarf-connections/runtime.json` by default and exports
its `token` as `CLAWSCARF_CONNECTIONS_TOKEN` before starting OpenClaw. An explicit
`OPENCLAW_STATE_DIR` changes the containing state directory. The
[credential loader](connections-credential.ts) accepts only a private JSON object
containing that scoped token; optional public CA trust lives in sibling `ca.pem`.
The directory and files must belong to the runtime user, have no group/other
permissions, and must not be symbolic links; files must have one hard link. Missing
configuration is a no-op, while partial, invalid or exposed material stops startup
with a generic diagnostic. The launcher captures the token privately without
shell evaluation, command-line arguments or Docker environment configuration.
This only delivers an operator-provisioned credential: it does not issue, rotate,
configure or enable the plugin. Credentials are confined to the Gateway home;
provider keys remain outside the native runtime. The
[startup regression](../tests/runtime/connections-credential.test.ts) covers secret
handling and rejected material, and the
[HTTPS trust regression](../tests/models/trust.test.ts) verifies all three CA sources
while rejecting an unrelated server certificate.

The stopped-volume [configuration helper](configure-connections.ts) accepts the
[strict input/result protocol](connections-configuration.ts) over stdin. It verifies
the installation owner/server marker and private paths, then delivers the scoped
credential and invokes the existing native plugin configuration helper. Each credential
file is replaced atomically; the file changes and native mutation are not one
transaction. A failure after delivery begins reports an incomplete outcome and
retains material for explicit inspection or reapplication. Successful configuration
requires matching native settings and reread credential bytes, while preserving
explicit plugin disablement unless the installation editor explicitly enables it.
The same helper can disable the plugin while retaining its credentials and unrelated
configuration. Observation requires a read-only home mount and never
repairs retained material. The [runtime regression](../tests/runtime/configure-connections.test.ts)
uses the actual pinned SDK and verifies configured observation without SQLite
sidecars or filesystem changes, source-file hashes, retained disablement and refusal
of invalid native core settings. Observation checks stored configuration, not loaded
tools; see [local activation](../deploy/deployment/README.md#activate-connections).

## Capability controls

The pinned native configuration owns these controls; administrators may deliberately
change them through OpenClaw. Refreshing or restarting ClawScarf does not reapply
the initial preset.

| Control                      | Native setting                  | Meaning                                                                                                                       |
| ---------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Plugin activation            | `plugins.entries.<id>.enabled`  | Enable or disable a particular plugin.                                                                                        |
| Plugin loading               | `plugins.allow`, `plugins.deny` | Native loading policy, with explicit denies; this does not curate the browsing UI.                                            |
| Bundled skill eligibility    | `skills.allowBundled`           | A nonempty list restricts bundled/Custodian skills; omitted or empty is unrestricted. Other skill sources are unaffected.     |
| Individual skill eligibility | `skills.entries.<name>.enabled` | Enable or disable an installed or bundled skill.                                                                              |
| Installation policy          | `security.installPolicy`        | Native approval policy for skill/plugin installation and updates; it requires a separately configured trusted policy command. |

An empty `plugins.allow` does not restrict loading. Native slot selections and
explicitly enabled bundled channels can take precedence over that allowlist;
explicit denies and disabled entries are evaluated earlier. Do not describe an
allowlist alone as a universal execution restriction.

Installation policy is an approval mechanism; catalog access can precede its
checks. Missing credentials or CLIs change eligibility, not what is installed.
The [capability probe](../tests/runtime/capabilities.mjs) exercises these controls;
its command and limits belong to the [image guide](../deploy/images/README.md#verified-limits).

The fresh-install preset sets `marketplace.enabled: false`. The paired
[marketplace intent](openclaw/patches/optional-marketplace.prompt.md) owns exactly
what the switch disables and preserves. A change to this setting requires Gateway
restart and UI reload. It does not physically remove packages. Open curation work
belongs to [TODO.md](../TODO.md#openclaw-curation); published configuration must be
checked against the selected [release](../release/README.md#release-evidence).

## External hosting boundary

A hosting platform can supply current trusted-ingress identity/admission, model
routing and a Connections broker. Do not run a second independent login authority
or copy its organization/fleet database into this distribution. The consumer owns
allocation, billing and infrastructure lifecycle; ClawScarf owns runtime artifacts.

Adoption must explicitly map the exact artifact, transport/endpoints, persistent
paths, UID ownership and supported operations. This runtime uses UID 1000 and a
persistent `/home/node` volume. A consumer with a separate data disk must mount that
state there rather than on disposable compute storage. Preserve allocation/volume
fencing, acting-user management, credential-generation verification, source-bound
inference authorization and revocation. Controller policy stays outside the runtime.
Published releases include Linux artifacts. A hosting consumer still needs to test
its own complete deployment against this contract before adoption.
