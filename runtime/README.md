# Native configuration

[configuration.ts](configuration.ts) defines the fresh-install preset. Generate a
new file with `node --import tsx scripts/runtime-config.ts --input setup.json
--output openclaw.json`. The input contains `publicOrigin`, `widgetOrigin` and the
exact `administratorIdentity` produced by the [access service](../services/access/README.md)
or a hosting platform's trusted ingress. The preset does not assign an identity
namespace or depend on either platform's database. The public origin configures both
browser admission and native OAuth callback/session/viewer link generation; widgets
retain their separate origin.
`standaloneNavigation` defaults to true and enables the bundled native account/People
navigation. A hosting platform supplying its own entry UI sets it to false.
The command refuses to overwrite a file. Validate with the pinned OpenClaw CLI
before launch; it is not a reconfiguration or migration command.

The preset is adapted from RawClaw's
[`runtime/openclaw/defaults.py`](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/runtime/openclaw/defaults.py).
It retains explicit initial identity, trusted ingress, disabled terminal/community
invite/external session catalogs, restricted Codex dynamic tools, separate widget
origin, self-only sessions, disabled elevated execution and Chrome's sandbox.
The OpenShell transport replaces the fixed Hetzner bridge addresses; the donor's
rootless-Docker UID mapping does not apply. Member policy requires native sandboxing;
execution remains unavailable until a separate execution backend is qualified.

Codex and Lobster are registered from the image's pinned native plugin directories.
Lobster remains subject to its native unsandboxed-context requirement. Chromium is
configured headless with its sandbox required; its current placement is unqualified.
Connections is bundled and registered without broker credentials; it contributes
no executable tools until configured. Remote model-catalog refresh and mDNS are
disabled in the denied-egress baseline. Native administrators can explicitly change
application settings. This file does not establish working browser, Codex, Lobster
or widget acceptance; those remain in [PLAN.md](../PLAN.md).

[openclaw.sh](openclaw.sh) is the image's `/app/clawscarf/bin/openclaw` launcher.
Use it for the canonical Gateway command and operator CLI execution. It sets the
persistent home/state defaults and SQLite temporary directory before invoking the
unmodified upstream executable. OpenShell operator execution does not inherit all
Docker image environment variables, so image `ENV` alone is insufficient.
When model setup installs a private gateway's public CA, the launcher adds it to
Node's process-wide trust through `NODE_EXTRA_CA_CERTS`. Explicit operator environment
configuration takes precedence. CA changes require a Gateway restart; no certificate
verification is disabled. Model tokens remain separate private native file secrets.

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

OpenClaw 2026.9.4 still mounts its Plugins discovery surface independently of these
loading controls. The public custom-page API adds pages; it does not remove core
navigation. Hiding ClawHub/unselected browsing is therefore unimplemented, pending
an upstream capability or an explicit maintenance decision. ClawScarf does not
hide it through injected CSS or reinterpret loading restrictions as a UI guarantee.
