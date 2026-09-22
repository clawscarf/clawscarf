# Installation CLI

`clawscarf configure` creates or changes an installation. The everyday lifecycle
commands are `start`, `stop`, `status` and `logs`. All use the same `--directory`.
The CLI manages its saved configuration; users do not write installation JSON or
run separate validation, preview and apply commands.

This alpha runs on macOS arm64 and Linux arm64/x86-64, including Windows through
WSL2 (experimental). Use Docker Desktop on macOS, Docker Engine with Compose on Linux, or Docker
Desktop with WSL2 integration on Windows. Install the CLI inside WSL2 and keep
the installation directory in its Linux filesystem.
Use Docker 29+ (automatic subnet allocation with fixed service addresses); Linux also requires glibc 2.28+ and the normal local Docker socket.
OpenShell’s mandatory filesystem protection must be available in the Docker host kernel.
Native Windows and Intel Mac are unsupported: pinned OpenShell supplies no Intel Mac tool.
Use the [standalone installer](../../README.md#get-started), which bundles Node and
the CLI dependencies. It installs under `~/.local` without changing your system Node
or shell profile; add `~/.local/bin` to PATH. Pass `--prefix /absolute/directory` to
the downloaded installer to change this location. Running a newer release's installer
updates the command while retaining the previous CLI version under `lib/clawscarf/`.
It does not upgrade an existing server or change its data.

Alternatively, use `npm install -g @clawscarf/cli@next` with your own Node 24.16+
(24.x) or 26.1+. Both distributions run the same CLI. Its bundled
[recipes](../../recipes/README.md) download pinned runtime tools and images.
Contributors can instead [link the development command](../../scripts/README.md#development-command)
which uses the checkout’s [pinned published runtime](../../release/README.md#published-and-development-use).
For a new installation, the CLI checks the host platform, Docker and Compose before
asking for setup answers or cloud sign-in. Selected listener ports are checked before saving a new installation,
then checked again during preparation and startup.

New installations retain their runtime definition and tools in their own `runtime/`
directory. Published definitions supply checksummed HTTPS tool downloads; configure
fetches missing tools before cloud sign-in. Custom definitions without download URLs require prepared local tools. Selected pack files are retained under `state/pack-sources/`.
Missing registry images are downloaded by their pinned digest before sign-in, with an
image list and layer progress on stderr; the first setup can take several minutes.
Already-cached images are reused. Local development image IDs cannot be downloaded:
build those images and regenerate the development release if they are missing.
`start` also fetches missing registry images; `doctor` only reports missing prerequisites.
The CLI does not install Docker. `start` verifies retained runtime tools; use `configure`
to acquire missing downloadable tools. Checksummed files that have changed fail visibly.

## Telemetry

A CLI release with a configured PostHog destination reports command usage and
failure codes by default. Disable all reporting before running any command:

```sh
export CLAWSCARF_TELEMETRY_DISABLED=1
```

The first reporting invocation prints a notice on stderr. JSON results stay on
stdout. Reporting runs on the machine executing the CLI, independently of team
login and Connections. It does not instrument OpenClaw, conversations or teammates.

Each dispatched command sends `cli_command_started` and, on normal completion or a
handled failure/cancellation, `cli_command_finished`. Both include the registered
command/subcommand name, a shared invocation ID, CLI version, OS, architecture,
whether stdin/stdout are terminals without `--non-interactive`, and a timestamp.
`stop` also distinguishes stopping from `--delete`. The finished event adds elapsed
milliseconds and success, failure, cancelled or action-required outcome. Failures
include a predefined error code (unknown codes become `operation_failed`) and the
command that failed. Configuration records new setup versus editing an installed
server when that choice is known, and saved, unchanged or ready when reached.
A resumed unfinished installation counts as new setup. A successful status query
is recorded as success even if the observed server is stopped; start/configure
returning incomplete readiness is action required.

A random UUID is stored in `$XDG_CONFIG_HOME/clawscarf/telemetry-id`, or
`~/.config/clawscarf/telemetry-id` when XDG_CONFIG_HOME is unset, with mode 600.
It persists across CLI upgrades and installations under that OS account. It
approximates returning operators, not distinct people or team members. Removing
this file resets the identifier and first-run notice. No identity file is accessed
or created when opted out. Invalid or inaccessible telemetry configuration/state
silently disables reporting for that invocation.

Events exclude arguments, raw configuration, paths, account identities,
credentials, logs, exception messages and stacks. The PostHog SDK adds its library
name/version; person-profile processing and GeoIP enrichment are disabled and the
event IP property is null. The configured PostHog project discards client IPs
from stored events; the ingestion server still receives the network connection's
source IP. See the release guide below for the required destination setting.

Delivery is best effort, with a 500 ms request timeout, no retries, no persistent
event queue and no ingestion redirects. Network failures never change command
output or exit status. Help, argument-validation failures before command dispatch,
and abrupt process termination may produce no events or only a started event;
a missing finished event is not proof of a failure. Reporting is not an audit log.
The [release guide](../../release/README.md#cli-telemetry-destination) owns destination
configuration and enablement status.

## Terminal installer

```sh
clawscarf configure \
  --directory ~/my-team
```

Choose a recipe, then review its editable settings. **Accept settings and continue**
is the first action. The menu separates team login, AI service and default model.
Cloud login is free; recommended Cloud AI is prepaid. Connections is optional and
paid beyond the account’s allowance. Provider-key billing remains selectable.
The menu shows the selected model and reasoning before
asking for missing credentials. Explicit command options preselect those same choices.
**Esc** discards unaccepted section changes and goes back; at the root it exits.
**Ctrl+C** exits. No services change until the final confirmation.

The [recipe definition](../../recipes/README.md) supplies editable defaults.
The runtime selection, OpenShell protection and authenticated entry are fixed.

`--recipe <name-or-file>` skips the picker: use `team-server` for the bundled
recipe or a path to a custom recipe JSON. Without it the menu lists all bundled
recipes. Sources live in [recipes](../../recipes/README.md); the CLI package includes
them, the model catalog and pack files. Each recipe points to its fixed runtime
in [runtime/current.json](../../runtime/current.json). There is no public
`--release` override. Runtime images/tools are separate [release artifacts](../../release/README.md).
Recipe defaults are copied once; changing a recipe never changes an existing server.

The directory defaults to `~/clawscarf-team` for configure, start, stop, status and
logs. Change it with `--directory` or the initial settings menu. Reusing a configured
directory opens its existing settings; it does not replace the installation.

For first setup, choose a new directory whose parent exists. Configuration and secrets
are saved there with private permissions. If setup is interrupted, rerun:

```sh
clawscarf configure --directory ~/my-team
```

Do not repeat new selections when resuming unfinished setup. Once preparation is
complete, the same command opens the editor for the existing installation.

**Install in …?** and **Start now?** default to Yes. Startup launches the Docker services
and protected OpenShell runtime, checks readiness, then leaves them running independently
of the terminal. No host daemon is installed. Docker must remain available. Use
`--no-start` to leave the server stopped.

## Login and administrator

Hosted login defaults to `https://cloud.clawscarf.com`. The
development `--cloud-url` override can select staging. Connections independently uses
that cloud unless `--connections-cloud-url` selects another service.

For hosted login, interactive configuration opens the browser and shows a clickable
`cloud.clawscarf.com/setup` link with the approval code to compare on the website.
Sign in or create an account, then approve this installation in the browser and return
to the terminal. That verified identity becomes this installation's first administrator.
The CLI starts the server and verifies native administrator access; there is no second
administrator sign-in. Closing the terminal preserves pending approval for the next
`configure --directory` invocation. An expired approval can be retried with a fresh link.
Once the installation is ready, configuration opens OpenClaw and prints its URL and
management commands. If automatic browser opening fails, use the printed link.
Noninteractive configuration never opens a browser.

For staging, select it when creating a **separate installation**:

```sh
clawscarf configure \
  --directory ~/my-team-staging --cloud-url https://cloud-staging.clawscarf.com
```

This selects staging for hosted login, Cloud AI and Connections. Production remains the default.
Existing installations retain their registered environment; this flag does not move
users, accounts or credentials between environments.

Use the Team login menu or `--access oidc` with your issuer/client credentials for company
OIDC. This avoids hosted login registration; Cloud AI and Connections remain independent choices.
Supply administrator subject/email together for unattended bootstrap, or follow the
private, 15-minute administrator link after startup. The installer waits while that
identity is bound and verified. Ordinary login cannot claim an uninitialized server.
Replace an expired company-OIDC setup link with
`clawscarf administrator --directory ~/my-team --issue`.

Registration keys are retained and reused. Retrying does not silently change cloud owners
or restore revoked credentials. Teammate invitations and external account linking belong
to native OpenClaw People and Connections, after installation. An empty Connections list
is a valid installed capability.

## Configure without prompts

The same command and options serve coding agents and scripts:

```sh
clawscarf configure --directory ~/my-team \
  --recipe team-server --model gpt-6-astra --provider openai --reasoning medium \
  --llm-key-file /private/openai-key \
  --non-interactive --json
```

Use model IDs returned by `clawscarf recipes`. Private key files contain
only the secret and must be regular files owned by you, with mode 600. A provider `.env`
file is also supported for multiple routes. Secrets never go in command-line values.

Noninteractive configuration checks the machine, validates required selections and ports,
saves configuration, checks bundled tools and downloads missing registry images, then
registers selected cloud services, prepares and starts the server. It does
not prompt. If sign-in is needed, it returns `state: "action_required"`, a browser URL,
expiry, polling delay and exact resume command. Complete the browser step, then run
that command; accepted selections and the pending registration are retained. The resume
command preserves an explicit `--no-start` choice. It does
not print provider tokens or silently choose an account. `--no-start` stops after preparation.

An existing short-lived owner token or provisioning credential can instead be supplied
with `--cloud-credential-file`. Provisioning credentials have no personal identity:
initial hosted setup also requires `--administrator-subject` and `--administrator-email`.
Company OIDC without explicit bootstrap returns its private administrator URL and
`ready: false`; this is not completed setup. Configuration also reports service and pack
readiness after startup; blocked packs or degraded services never count as ready.

Precedence is recipe defaults, explicit options, then accepted menu edits. Omitted options
preserve defaults (or current choices); `--no-connections`, for example, explicitly turns
a capability off. Relative file paths resolve from the calling directory.

### Configuration options

Run `clawscarf configure --help` for descriptions. The relevant groups are:

| Choices                | Options                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Initial setup          | `--directory`, `--recipe`, `--name`, `--administrator-name`                                                                            |
| Models                 | `--ai-service`, `--model`, `--provider`, `--reasoning`, `--llm-key-file`, `--provider-env-file`                                        |
| Login                  | `--access hosted\|oidc`, `--oidc-issuer`, `--oidc-client-id`, `--oidc-secret-file`, `--administrator-subject`, `--administrator-email` |
| Local networking       | `--port`, `--widget-port`                                                                                                              |
| HTTPS networking       | `--origin`, `--widget-origin`, `--tls-certificate`, `--tls-key-file`                                                                   |
| Capabilities           | `--connections` / `--no-connections`, `--browser` / `--no-browser`, `--public-web` / `--no-public-web`, `--cpu`, `--memory`            |
| Packs                  | repeat `--pack <id:member,member>`, `--no-packs`, repeat `--pack-bindings <id=file>`, `--pack-python`                                  |
| Advanced model gateway | `--model-catalog`, `--model-gateway-url`, `--model-gateway-key-file`, `--model-gateway-ca-file`                                        |
| Automation             | `--non-interactive`, `--yes`, `--start` / `--no-start`, `--json`, `--cloud-credential-file`                                            |
| Service overrides      | `--cloud-url`, `--connections-cloud-url`                                                                                               |

## Optional capabilities

### Models

Models always use bundled or external LiteLLM. An external gateway needs its actual model
catalog, HTTPS endpoint ending in `/v1`, and a scoped inference key; never supply its master
key. Bundled models keep provider keys outside OpenClaw and issue a scoped runtime key.
See [models](../models/README.md) for catalog and credential contracts.

`--ai-service cloud` uses prepaid ClawScarf Cloud AI through bundled LiteLLM.
The installer uses the existing Cloud owner approval to enable hosted AI, checks
the selected model against Cloud's live catalog, and retains a scoped inference
credential outside OpenClaw. It reports the actual available account balance after
sign-in without promising a fixed free allocation. Exhausted, pending or suspended
credit does not disable login. Cloud API credentials and purchased balances never
become provider keys in the runtime.

`--ai-service provider` selects your own provider billing. Supplying `--provider`,
`--llm-key-file` or `--provider-env-file` also selects that path. An existing
installation keeps its accepted service unless you explicitly change it.
Cloud AI enablement requires the owning Cloud user's authorization; a provisioning
credential alone cannot authorize spending. Native purchase controls are separate
from installer registration.

### Public web

The Team server recipe starts with public HTTP(S) access enabled. Set
`--no-public-web` to restrict the runtime to explicitly configured services;
`--public-web` enables it again. Both are available during initial and retained
configuration, including the **Public web** menu section. Existing settings are
never changed merely by updating the recipe.

This controls agent/runtime egress, not which plugins are installed. Native
dashboard network grants remain separate. See the
[network boundary](../openshell/README.md#public-web-access) for private-address
blocking, proxy requirements and data-sharing implications.

### Connections

Use `--connections` or `--no-connections` during initial or retained configuration.
Accounts and agent grants are managed afterward in the native Connections page or
with the [Connections management CLI](../../services/connections/README.md). Disabled
Connections needs no broker credentials and exposes no native Connections tools or page.
The installer contains no local broker or connector catalog.

### Packs

Packs are CLI-bundled native Claws with explicit member selections. The pinned Python
OpenShell SDK is currently required by their operator. Account-dependent members need
[bindings](../../packs/README.md); configuration never invents accounts or grants.

## Team administration

Use native [People](../../plugins/access/README.md) for invitations and roles, and
[Connections](../../plugins/connections/README.md) for external accounts and agent grants.

Authenticated automation uses the same generated REST client:

```sh
clawscarf people --origin https://team.example --session-file /private/session list
clawscarf people --origin https://team.example --session-file /private/session invite colleague@example.com
clawscarf people --origin https://team.example --session-file /private/session invitations
clawscarf people --origin https://team.example --session-file /private/session role USER_ID admin --expected-role member
clawscarf people --origin https://team.example --session-file /private/session remove USER_ID
clawscarf people --origin https://team.example --session-file /private/session revoke-invitation INVITATION_ID
```

Use `clawscarf connections --help` for account operations. Both command groups use
a currently signed-in user's private session file and enforce the same native
authority as their pages; an operator filesystem credential is not a role override.

## Change an existing installation

```sh
clawscarf configure --directory ~/my-team
```

This loads accepted choices and opens the Models, Connections, Public web and Packs editor.
Review and confirm the change; the CLI handles stopping, applying and optionally starting.
Unrelated native edits and data are retained. For automation:

```sh
clawscarf configure --directory ~/my-team --reasoning high \
  --non-interactive --yes --json
```

`--yes` is required for unattended changes to an existing installation. Changes can restart
the server; removing packs can remove their native-owned agents, workspaces and sessions.
Supported changes are models, routes/keys, Connections enablement, public web access and pack selections.
Release, identity, login, addresses, resources and execution protection stay fixed. Changing
model gateway ownership or moving broker accounts is a separate deployment change and is
rejected here.

Unchanged settings leave the running server alone. Changed capabilities are applied
independently: changing Connections or packs does not reset model defaults. To deliberately
restore managed model or Connections settings after native edits, use
`configure --directory /path/to/team --reapply models` (or `connections`). Review
and confirmation still apply. Interrupted changes retain that explicit selection.

Ordinary `start` does not reapply configuration. Model changes retain the scoped gateway
key without restoring revoked authority; individual native agent overrides are preserved.
Disabling Connections preserves its cloud accounts and grants. Re-enabling does not restore
revoked credentials. Pack changes use native ownership checks at the next start; uncertain
pack mutations are never automatically replayed.

An interrupted cloud authorization retains the proposed settings without blocking startup of the accepted configuration. In the menu, decline resuming to discard an authorization-only draft. If applying a change is interrupted, startup remains blocked. Rerun `configure --directory`
without new selections to review and explicitly resume the saved change. Stale previews
are rejected internally. You do not pass a candidate file or fingerprint.

## Start, stop, status and logs

```sh
clawscarf start --directory ~/my-team
clawscarf status --directory ~/my-team
clawscarf logs --directory ~/my-team --service controller
clawscarf stop --directory ~/my-team
```

Human-readable output is the default; `--json` puts structured results on stdout and
progress/errors on stderr. Startup uses the same progress display as configuration.
`status` observes Docker services, native HTTP health, administrator setup and pack results;
readiness is not proof of a successful model response. `logs --help` lists service names;
logs show the last 100 lines. A stopped Docker engine is unavailable, not a confirmed stopped
installation. `doctor --directory` checks configuration, tools and local images without
allocating a server.

Stop preserves containers and data for restart. To delete owned Docker resources and data:

```sh
clawscarf stop --directory ~/my-team --delete
```

Two confirmations default to No. Unattended deletion requires both acknowledgments:

```sh
clawscarf stop --directory /absolute/my-team --delete \
  --confirm-delete /absolute/my-team --accept-data-loss --json
```

The confirmation must exactly match the absolute installation directory. The command removes
only that installation's resources, never prunes Docker or removes another container to free
a volume. Images, cloud accounts and the local folder remain. After successful deletion,
move or remove the folder before configuring the same path again, or choose a new
`--directory`. The retained folder still holds private configuration and credentials;
it cannot be edited or restarted as an installed server after deletion.
A failed deletion can be retried; invalid ownership records block it. Startup settings need
not be valid for deletion.

## Implementation and limits

Validation, preparation and retained changes share the deployment operators and lock owned
state during mutations. A preview is not a port reservation: ports are checked again at
preparation. Retained volumes and stop/start are not backups. Docker restarts Compose
services unless explicitly stopped; OpenShell owns sandbox lifecycle.

For capability support, use the owning [runtime](../../runtime/README.md),
[browser](../execution/browser-node/README.md#verified-release-limits),
[pack](../../packs/README.md) and [Connections](../../plugins/connections/README.md)
guides. [Release evidence](../../release/README.md#release-evidence) describes how to
verify a published artifact; [TODO.md](../../TODO.md) is the only open-work list.

CLI failures identify deliberate configuration errors and file paths without echoing
file contents, provider responses or subprocess output. `--json` keeps the same
error code and detail on stderr. Unknown failures remain sanitized; mutations are
never retried automatically.

People and Connections commands share session validation, CSRF acquisition and a
90-second operation deadline. Session files must be private. Management requests
require HTTPS (or loopback HTTP), reject redirects and never retry mutations.

### Cloud balances and purchases

With Cloud AI or Connections selected, native installation administrators can open
[Account](../../plugins/access/README.md) to see balances and available packs.
Purchasing requires an explicit sign-in as that Cloud account's owner. Checkout
and payment details open on Stripe; selecting a paid service in the installer does
not purchase a pack or enable automatic recharge. Prices and any free allocation
come from Cloud and may change for new accounts.

When AI credit runs out, requests fail and the native plugin directs administrators
to Account. Other team members should ask their installation administrator. When
Connections actions run out, Account shows the daily reset and prepaid packs.
A pending payment or credit activation should be checked before paying again.
Neither case blocks team login. These features require the CLI, companion and
native plugin built from this source; they have not been published by this change.
Existing installations retain their configured services and credentials.
