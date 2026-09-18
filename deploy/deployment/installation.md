# Installation CLI

`clawscarf configure` creates or changes an installation. The everyday lifecycle
commands are `start`, `stop`, `status` and `logs`. All use the same `--directory`.
The CLI manages its saved configuration; users do not write installation JSON or
run separate validation, preview and apply commands.

This is a developer preview for macOS arm64 with Docker Desktop. Published downloads
remain unfinished. [Link the development command](../../scripts/README.md#development-command)
and prepare the runtime artifacts selected by the [recipe](../../recipes/README.md) before configuring a server.
For a new installation, the CLI checks macOS/architecture, Docker and Compose before
asking for setup answers or cloud sign-in. Selected listener ports are checked before saving a new installation,
then checked again during preparation and startup.

OpenShell tools come in the release bundle and are checked against its checksums.
Missing registry images are downloaded by their pinned digest before sign-in, with an
image list and layer progress on stderr; the first setup can take several minutes.
Already-cached images are reused. Local development image IDs cannot be downloaded:
build those images and regenerate the development release if they are missing.
`start` also fetches missing registry images; `doctor` only reports missing prerequisites.
The CLI does not install Docker or download an incomplete release bundle's missing tools.

## Terminal installer

```sh
clawscarf configure \
  --directory ~/my-team
```

Choose a recipe, then review its editable settings. **Accept settings and continue**
is the first action. The menu shows the selected model, provider and reasoning before
asking for missing credentials. Explicit command options preselect those same choices.
**Esc** discards unaccepted section changes and goes back; at the root it exits.
**Ctrl+C** exits. No services change until the final confirmation.

The illustrative **Team documents** recipe selects GPT-6 Astra through OpenAI with
medium reasoning and enables Connections. It does not include a document ingestion
workflow. All recipe defaults except the runtime can be edited. Recipes
cannot disable OpenShell protection or authenticated entry.

`--recipe <name-or-file>` skips the picker: use `team-documents` for the bundled
recipe or a path to a custom recipe JSON. Without it the menu lists all bundled
recipes. Sources live in [recipes](../../recipes/README.md); the CLI package includes
them, the model catalog and pack files. Each recipe points to its fixed runtime
under [runtime/releases](../../runtime/releases/0.1.0-dev.json). There is no public
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

This selects staging for hosted login and Connections. Production remains the default.
Existing installations retain their registered environment; this flag does not move
users, accounts or credentials between environments.

Use the Access menu or `--access oidc` with your issuer/client credentials for company
OIDC. This avoids hosted login registration; Connections remains independently optional.
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
  --recipe team-documents --model gpt-6-astra --provider openai --reasoning medium \
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
| Models                 | `--model`, `--provider`, `--reasoning`, `--llm-key-file`, `--provider-env-file`                                                        |
| Login                  | `--access hosted\|oidc`, `--oidc-issuer`, `--oidc-client-id`, `--oidc-secret-file`, `--administrator-subject`, `--administrator-email` |
| Local networking       | `--port`, `--widget-port`                                                                                                              |
| HTTPS networking       | `--origin`, `--widget-origin`, `--tls-certificate`, `--tls-key-file`                                                                   |
| Capabilities           | `--connections` / `--no-connections`, `--browser` / `--no-browser`, `--cpu`, `--memory`                                                |
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

## Change an existing installation

```sh
clawscarf configure --directory ~/my-team
```

This loads accepted choices and opens the Models, Connections and Packs editor.
Review and confirm the change; the CLI handles stopping, applying and optionally starting.
Unrelated native edits and data are retained. For automation:

```sh
clawscarf configure --directory ~/my-team --reasoning high \
  --non-interactive --yes --json
```

`--yes` is required for unattended changes to an existing installation. Changes can restart
the server; removing packs can remove their native-owned agents, workspaces and sessions.
Supported changes are models, routes/keys, Connections enablement and pack selections.
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
you can remove the folder, which still holds private configuration and credentials.
A failed deletion can be retried; invalid ownership records block it. Startup settings need
not be valid for deletion.

## Implementation and limits

Validation, preparation and retained changes share the deployment operators and lock owned
state during mutations. A preview is not a port reservation: ports are checked again at
preparation. Retained volumes and stop/start are not backups. Docker restarts Compose
services unless explicitly stopped; OpenShell owns sandbox lifecycle.

Fresh setup previously passed persistent startup, private administrator claim, WorkOS login
and a real model response on macOS arm64. The current single-runtime image passed native
uploads, file tools, Python, Lobster, PDF extraction and persistent restart through the
[runtime acceptance test](../openshell/README.md#repeatable-boundary-and-retention-check).
The current installer also passed fresh hosted registration against staging, native
administrator verification and entry without a second login on macOS arm64. A live
GPT-6 Astra / medium response passed after correcting the recipe to use the Responses
API. Production sign-in and sign-up forms render correctly; complete new-account
email verification remains untested.
Real Outlook linking, reconnect, execution and revocation passed locally.

Pack removal can be blocked by attached automations whose ownership cannot be established
through the native CLI under trusted-proxy login. The agent is retained and the failure
reported. Browser routing has its documented upstream limitation. Linux/WSL, clean-machine
release installation, complete release upgrades, external ingress and directory-backed
hosting storage remain unfinished. [TODO.md](../../TODO.md) owns the open work.

CLI failures identify deliberate configuration errors and file paths without echoing
file contents, provider responses or subprocess output. `--json` keeps the same
error code and detail on stderr. Unknown failures remain sanitized; mutations are
never retried automatically.

People and Connections commands share session validation, CSRF acquisition and a
90-second operation deadline. Session files must be private. Management requests
require HTTPS (or loopback HTTP), reject redirects and never retry mutations.
