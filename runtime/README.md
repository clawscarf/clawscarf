# Native configuration

The [OpenClaw distribution guide](openclaw/README.md) explains configuration,
packaging and source patch maintenance. The maintained series adds optional
marketplace availability and corrects browser-routing guidance;
[TODO.md](../TODO.md#openclaw-curation) owns remaining curation work.

[private-files.ts](private-files.ts) owns bounded private-file reads and staged directory publication. Runtime and browser initializers retain their own resume/identity policies; they share file ownership and publication mechanics.

[configuration.ts](configuration.ts) defines the fresh-install preset used internally by installation.
The input contains `publicOrigin`, `widgetOrigin` and the
exact `administratorIdentity` produced by the [access service](../services/access/README.md)
or a hosting platform's trusted ingress. The preset does not assign an identity
namespace or depend on either platform's database. The public origin configures both
browser admission and native OAuth callback/session/viewer link generation; widgets
retain their separate origin.
`standaloneNavigation` defaults to true and enables the bundled native account/People
pages. A hosting platform supplying its own entry UI sets it to false.
Initialization refuses to overwrite existing configuration and validates with the pinned OpenClaw CLI
before launch; it is not a reconfiguration or migration command.

The preset is adapted from RawClaw's
[`runtime/openclaw/defaults.py`](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/runtime/openclaw/defaults.py).
It retains explicit initial identity, trusted ingress, disabled terminal/community
invite/marketplace/external session catalogs, restricted Codex dynamic tools, separate widget
origin, self-only sessions, disabled elevated execution and Chrome's sandbox.
The OpenShell transport replaces the fixed Hetzner bridge addresses; the donor's
rootless-Docker UID mapping does not apply. The preset sets
`agents.defaults.sandbox.mode: off`, member `sandbox: inherit` and
`tools.exec.host: gateway`, while keeping native `exec.mode: auto` approvals.
OpenShell still encloses the whole runtime. See the [security contract](../README.md)
for the resulting team trust boundary. Pending identities still have no agent/tool access.

Codex uses the pinned upstream image's bundled plugin and dependency closure.
Lobster is registered from the separately included official release directory.
Lobster runs in its ordinary native context inside the outer OpenShell boundary. Chromium is
configured headless with its sandbox required. The
[separate browser image](../deploy/execution/browser/README.md) has component
sandbox/authentication/persistence acceptance. Its [native node integration](../deploy/execution/browser-node/README.md#verified-release-limits)
passes administrator browsing with the routing fix, but member permissions and
download transfer block browser enablement by default; see [TODO.md](../TODO.md).
Connections is bundled but disabled in the base preset. Selecting the capability enables
its native page and scoped broker tools; disabling it removes both. Remote model-catalog refresh and mDNS are
disabled in the denied-egress baseline. Native administrators can explicitly change
application settings. The [image guide](../deploy/images/README.md#verified-limits)
owns exercised capability limits; [TODO.md](../TODO.md) tracks combined runtime and
release qualification.

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

Replacement images support an operator-controlled startup gate. When
`CLAWSCARF_START_GATE` contains an upgrade UUID, the launcher waits for the matching
root-owned `/etc/clawscarf-start-ready` marker before starting OpenClaw. The operator
restores controller settings and stops compute before publishing that marker. The next
normal start boots the supervisor with restored settings before launching OpenClaw.
It is absent from normal fresh startup; it does not change OpenClaw itself or store
controller credentials in the guest. See the [upgrade procedure](../deploy/deployment/README.md#runtime-upgrade).

## Capability controls

The pinned native configuration owns these controls; administrators may deliberately
change them through OpenClaw. Refreshing or restarting ClawScarf does not reapply
the initial preset.

| Control                      | Native setting                  | Meaning                                                                                                                       |
| ---------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Plugin activation            | `plugins.entries.<id>.enabled`  | Enable or disable a particular plugin.                                                                                        |
| Plugin loading               | `plugins.allow`, `plugins.deny` | Native loading policy, with explicit denies; this does not curate the browsing UI.                                            |
| Bundled skill eligibility    | `skills.allowBundled`           | Restrict bundled skills, without restricting other skill sources.                                                             |
| Individual skill eligibility | `skills.entries.<name>.enabled` | Enable or disable an installed or bundled skill.                                                                              |
| Installation policy          | `security.installPolicy`        | Native approval policy for skill/plugin installation and updates; it requires a separately configured trusted policy command. |

An empty `plugins.allow` does not restrict loading. Native slot selections and
explicitly enabled bundled channels can take precedence over that allowlist;
explicit denies and disabled entries are evaluated earlier. Do not describe an
allowlist alone as a universal execution restriction.

The image's [capability probe](../tests/runtime/capabilities.mjs) exercises native
CLI plugin disable/enable and individual skill eligibility in a disposable
configuration. Disabling Lobster removes it from loaded plugins while leaving Codex
loaded; reenabling restores it. Skill disable/enable changes native eligibility,
and these edits preserve unrelated configuration. This checks the image's native
controls, not hot reload, menu hiding or shell authorization.

The [marketplace patch](openclaw/patches/optional-marketplace.prompt.md) adds
`marketplace.enabled: false` to suppress native discovery UI and reject its native
catalog operations. The fresh-install preset selects this setting; native
explicit-source administration remains available. The cleaner administrator install
interface and physical package selection remain unfinished. Published alpha.4
contains the switch but predates the preset change. See the
[release guide](../release/README.md#build-and-publish) for packaged verification.
Package removal and wider UI curation remain separate work.
Loading restrictions alone still do not establish a curated browsing UI.

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
