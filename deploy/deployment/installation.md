# Unified installation CLI

The unified CLI composes the existing [deployment operators](README.md). It requires
OpenShell, the protected shared worker and authenticated entry. The current target
is macOS arm64 with Docker Desktop. Published downloads remain unfinished. The
terminal installer covers initial setup. Required LiteLLM, optional Connections and pack selections
are wired into initial preparation and startup.

The installed command and all terminal command suggestions use `clawscarf`.
The `pnpm clawscarf` examples below are for running this unreleased source checkout.

The selected [hosted-services design](../../docs/cloud-services.md) replaces token-only
evaluation login with hosted OIDC by default and customer OIDC as the alternative,
without bundling an identity server. The installer defaults to `https://cloud.clawscarf.com`;
a release's `cloudUrl` or `--cloud-url` can select staging. Connections can be enabled
independently of hosted or custom OIDC login.
There is no token-only fallback when cloud configuration is missing.

A fresh team installation passed normal Docker network allocation, persistent startup,
private first-administrator setup through local Dex, native browser login and a GPT-6
Astra response through the configured model gateway. Closing the initiating command
left the server running. Earlier retained-state checks also preserved native appearance,
worker files and revoked credentials across stop/start.

These are local macOS arm64 checks, not a published-release or public deployment test.
Real Outlook linking, reconnect, execution and revocation passed with the local cloud
service. Fresh installation against the deployed cloud remains under verification.

## Development release

Build components using their [image recipes](../images/README.md). Generate a
portable release directory from explicit built-component inputs:

```sh
pnpm clawscarf release-create --input /absolute/built-components.json \
  --output /absolute/release-bundle
```

The input follows the [release contract](../../scripts/release/definition.ts):
`schemaVersion`, `version`, `sourceRevision`, `platforms`, `images`, `recipes` and `tools`.
`packs` optionally lists source pack directories; recipes select their IDs and members.
`modelCatalog` supplies selectable model/provider routes and reasoning levels; when
omitted, the builder uses [the bundled catalog](../models/catalog.json).
Connections catalogs are deployed with the cloud backend; installation releases contain
the native plugin and its packaged icons.
Use exact image digests, the pinned PostgreSQL/LiteLLM images, and recipe objects from
[deploy/recipes](../recipes/README.md). Under `tools.openshell`, provide `version` and
`cli`/`gateway` as executable file paths relative to the input file; the builder computes
checksums and copies tools into the output. No administrator, secrets, ports or installation
state are release inputs. Output creation refuses to overwrite an existing directory.

The release file pins images, executable checksums and supported platforms. Tool
file paths resolve relative to the release file. It contains no installation secrets.
Payload paths are relative to the generated **clawscarf-release.json**, so the directory
can move as a unit. It does not publish/download components or verify their runtime
behavior. Local image IDs work for development only. The
[release guide](../../release/README.md) owns bundle layout, versioning and publication design.

## Configure and run

### Terminal installer

From the checkout, with an already prepared release:

```sh
pnpm clawscarf install --release /absolute/release-bundle/clawscarf-release.json --directory ./team
```

Without `--release`, the operator looks for **clawscarf-release.json** in its
**release** directory. No published bundle exists yet: development uses
an explicit release from `release-create`, which now embeds the recipe catalogue.
There is no release-path prompt or software-source menu. `--recipes <directory>`
replaces that catalogue for development; `--recipe <id>` skips the starting-point picker.
For a new installation, the directory must be new and its parent must exist.
Resume saved setup with `clawscarf install --directory ./team`, without repeating recipe
or release flags. It reuses the saved cloud registration and never changes its keys. The installer requires an interactive
terminal and the release's exact local images/OpenShell executables; it does not build
or download missing components.

Choose a recipe, then review its editable settings. **Accept settings and continue**
is the first menu action. The Models section selects the default model, provider and
reasoning level from the release catalog; the summary shows those choices before asking
for an **LLM API key**. Advanced settings can import a model catalog or use an existing
LiteLLM gateway. Connections defaults to off. Enabling it uses ClawScarf Cloud;
the installer asks for cloud owner approval only when a registration is needed.
Provider credentials and the connector catalog stay in the cloud.
Account linking and teammate enrollment remain separate, deferred application work.

**Esc** discards unsaved section edits and returns to its parent. At the recipe picker,
Esc exits. **Save section changes** accepts edits; accepted answers survive navigation.
**Ctrl+C** exits. Secrets are requested after the settings review and only for enabled
services with missing credentials. Supplied CLI settings skip answered questions.
Secrets stay in memory until the final install confirmation, then referenced credentials
are copied to private files; they never appear in summaries or ordinary configuration.

The final **Install in …?** confirmation defaults to **Yes**. After confirmation,
the CLI checks prerequisites and applies the same preview used by
noninteractive commands. **Start now?** is the final choice, with **Yes** selected by
default, including after applying settings changes. Declining leaves a prepared,
stopped installation. Starting brings up Docker services and protected OpenShell
containers, then exits. Closing the terminal leaves the server running; Docker must
remain available. No host service is installed.

ClawScarf login is selected by default. After accepting settings, the installer shows a
browser authorization link to register the installation under your cloud account. It
saves the registration request and keys privately before dispatch and pins your account;
retrying after interruption cannot silently switch accounts or recreate revoked keys.
After successful registration, retained setup does not need the cloud registration API.
Normal login still needs the configured identity provider.

After startup, the terminal highlights a private, 15-minute, one-use administrator link.
Open it and sign in; Access binds that identity and verifies native administrator authority.
The browser asks you to return to the terminal, where the installer continues automatically.
Ordinary sign-in cannot claim the server. Expired links offer a retry; cancelling leaves
services running. Links are clickable in supporting terminals. `administrator --issue`
can replace an expired link; completed setup cannot be reclaimed.

Use the Access settings section, or `access.mode: "oidc"` in CLI settings, for your own
issuer and client credentials. No cloud registration occurs in this mode. Subject/email
bootstrap is optional for unattended setup; otherwise it uses the same administrator link.
Network settings independently select loopback or HTTPS; the latter needs DNS and TLS.

Unattended hosted setup uses `configure --cloud-credential-file /private/credential`,
with a cloud owner token or account provisioner credential. The token is read from a
private file, never from a command-line value. Resume with the same `configure --directory`
and credential-file flags. Installation management/runtime keys cannot register servers.

The illustrative **Team documents** recipe supplies GPT-6 Astra through direct OpenAI,
with medium thinking. It does not include document ingestion or a document workflow.
See [retained settings](#change-an-existing-installation) for supported changes and
[TODO.md](../../TODO.md) for unfinished release and native application work.

### Configure without prompts

The same recipe/default and configuration writer are available to scripts and coding
agents. This command writes configuration only; it does not claim the server is ready.

```sh
pnpm clawscarf recipes --release /absolute/clawscarf-release.json
pnpm clawscarf configure --release /absolute/clawscarf-release.json \
  --recipe team-documents --settings ./settings.json --directory ./team
```

Settings replace complete sections rather than recursively merging obsolete fields:

```json
{
  "name": "documents",
  "access": { "mode": "hosted", "administratorName": "Sam" },
  "models": { "mode": "litellm", "upstreamEnvironmentFile": "./providers.env" }
}
```

The same `--settings` file can be supplied to `install`; complete supplied sections
skip their questions. The example uses the recipe's model catalog and a private
providers.env containing OPENAI_API_KEY. Without a recipe catalog, Models must
also supply configurationFile. Noninteractive configuration rejects missing credentials
or disabled Models before writing files; it never prompts. Credentials belong in private
files, not literal command-line arguments. Precedence is recipe defaults, settings overrides,
then accepted interactive edits.

Use `--recipe custom` for the same baseline without a recipe. Input-file references in
settings resolve against that file; generated state remains relative to the new
installation. The saved configuration records recipe ID/release as provenance only:
subsequent startup does not reload or inherit changing recipe definitions.
Continue with `validate`, `doctor`, `plan`, `apply` and `start` below. These remain
the authority for actual file, runtime and dependency verification. Commands show human-readable results by default. Add `--json` for structured results
on stdout; progress and errors go to stderr. For example,
`node --import tsx scripts/clawscarf.ts status --state ./state --json`. When using
pnpm, add its `--silent` option to suppress its own command banner. `settings --json` exports
the accepted configuration instead of opening its menu; `logs --json` returns the log
text in a structured result. Interactive `install` has no JSON mode; use `configure`
for unattended setup.

### Author the configuration directly

Installation paths resolve relative to the installation configuration file. Secret
files must be regular, private files owned by the operator. A minimal example:

```json
{
  "schemaVersion": 1,
  "name": "team",
  "releaseFile": "./clawscarf-release.json",
  "stateDirectory": "./state",
  "exposure": {
    "mode": "local",
    "applicationPort": 18800,
    "widgetPort": 18802
  },
  "access": { "mode": "hosted", "administratorName": "Administrator" },
  "resources": {
    "gateway": { "cpu": "2", "memory": "2Gi" },
    "worker": { "cpu": "2", "memory": "2Gi" }
  },
  "browser": { "enabled": false },
  "models": {
    "mode": "litellm",
    "configurationFile": "./routes.json",
    "upstreamEnvironmentFile": "./secrets/providers.env"
  },
  "connections": { "mode": "disabled" },
  "packs": []
}
```

```sh
pnpm clawscarf validate --config installation.json
pnpm clawscarf doctor --config installation.json
pnpm clawscarf plan --config installation.json --output preview.json
pnpm clawscarf apply --config installation.json --plan preview.json --yes
pnpm clawscarf start --state ./state
```

`validate` checks configuration, release integrity and referenced files. `doctor`
also checks Docker, Compose and the selected local images. It does not allocate
networks or prove that Docker has sufficient capacity. `plan` selects internal ports
and records the observed installation state. Ports are checked again at preparation;
a preview is not a reservation. Apply rejects changed inputs/state. After an interrupted
apply, create a fresh preview to resume; existing resource receipts govern resumption.
A successful apply means prepared, not a verified running application.

Start uses the same progress display as installer startup and retained settings.
Interactive terminals show a spinner; redirected output and `--json` use plain
progress messages on stderr. Start brings up Docker Compose services and the protected
OpenShell containers, checks readiness, then exits. Closing the terminal leaves the
server running while Docker is running. No host service is registered. Start reports server readiness without generating
a login credential. Use `administrator --issue` for a pending administrator setup.
Use the same CLI for operation (here the installation directory is `./team`):

```sh
pnpm clawscarf status --directory ./team
pnpm clawscarf stop --directory ./team
pnpm clawscarf logs --directory ./team --service controller
```

`--directory` is the same folder supplied to `install` or `configure`. Existing-installation
commands (start, stop, status, logs, administrator, settings, upgrade and Connections
operations) read its installation.json to locate state, including a custom state location.
Alternatively, pass `--state` with the private state folder itself, for example
`pnpm clawscarf status --state ./team/state`. Supply one location option, not both.
Settings plan/apply still take `--config` because they review a candidate configuration.

`stop` waits for entry and the owned OpenShell containers to stop, then stops the
controller and other Compose services. Data and containers remain for the next start.

To permanently remove an installation, use `clawscarf stop --directory ./team --delete`.
It asks twice, with **No** selected by default, then stops and removes only that
installation's Docker containers, volumes and networks. Chats, files, database contents
and browser profiles in those volumes are lost. Images, external services and the local
installation folder remain. After successful deletion, remove the folder yourself;
it still contains private configuration and credentials and cannot be restarted.
If deletion fails, keep the folder and rerun the same command after resolving the error.
The command never prunes Docker or forcibly removes another container to free a volume.

For unattended use, both acknowledgments are required:

```sh
clawscarf stop --directory ./team --delete \
  --confirm-delete /absolute/team/state --accept-data-loss --json
```

`--confirm-delete` must exactly match the resolved absolute state directory.
Without these two acknowledgments, noninteractive/JSON deletion fails without changes.

`status` observes actual containers, native HTTP health, administrator setup and pack
outcomes. It reports running, degraded or stopped; it never relies on a host daemon's
cached state. Readiness does not prove a fresh model response or upstream-provider health.
`logs` reads the last 100 lines from the selected Compose service; treat logs as private.
`logs --help` lists service names. A service failure does not shut down unrelated services;
Docker restarts exited Compose services unless explicitly stopped. OpenShell owns sandbox
lifecycle; use start to resume stopped sandboxes. A stopped Docker engine is reported as
unavailable, not as a confirmed stopped installation.
Normal sign-in starts from the application URL and goes directly to the configured identity provider.

OIDC supports the private administrator claim or explicit subject/email bootstrap.
It can be combined with local loopback exposure; network-accessible exposure requires HTTPS.
Copyable invitation links and native People management are available, with explicit
removal through People rather than automatic directory offboarding. Browser use retains
the documented upstream limitation.
Optional modes are described below. External platform access and directory-backed
storage remain unsupported.

## Optional capabilities

All paths resolve against the installation document. LiteLLM is required, either bundled
or externally operated. Disabled Connections
creates no Connections database schema and exposes no connector tools.

### Models

- `{"mode":"external","configurationFile":"models.json","credentialFile":"secrets/model-key"}`
  uses an existing HTTPS LiteLLM gateway; optional `caFile` supplies private trust.
  Under Advanced model gateway settings, the installer asks for the LiteLLM API URL and its scoped key;
  it can reuse the recipe model catalog or import the gateway's actual model IDs. The model
  file uses the existing [model configuration](../models/README.md). Supply a scoped
  inference credential, never the gateway administrator key.
- `{"mode":"litellm","configurationFile":"routes.json","upstreamEnvironmentFile":"secrets/providers.env"}`
  starts the pinned LiteLLM image and its own PostgreSQL service/volume. The operator
  creates private TLS and a scoped inference key. Only that runtime key reaches OpenClaw.
  Upstream keys and LiteLLM administration remain outside Gateway/worker state.

The bundled route file contains `defaultModel`, `models` and optional `thinkingDefault`; it has no endpoint or
mode field because the operator allocates the private endpoint. For example:

```json
{
  "defaultModel": "team",
  "models": [
    {
      "id": "team",
      "name": "Team",
      "enabled": true,
      "contextWindow": 32768,
      "maxTokens": 4096,
      "reasoning": false,
      "tools": true,
      "input": ["text"],
      "route": {
        "model": "openrouter/YOUR_CHOSEN_MODEL",
        "apiKeyEnv": "OPENROUTER_API_KEY"
      }
    }
  ]
}
```

Replace the illustrative route and capabilities with your actual provider model.
The private environment file contains exactly the credential variables referenced
by enabled routes, e.g. `OPENROUTER_API_KEY=...`. The generated endpoint binds only
loopback and uses HTTPS; the model database has no published port. OpenShell admits
the Gateway's model endpoint explicitly. This is not a blanket network restriction
on LiteLLM's upstream calls. Its migrations are owned by LiteLLM, separately from Access.

Issuance is recorded before calling LiteLLM. If the response is lost, preparation
stops for inspection rather than issuing another key. Restarts and repeated preparation
reuse the same key; they do not restore revoked authority. Retain both the private
state directory and the models database volume.

### Connections

Native cloud account management uses the same Access session as OpenClaw:

```sh
clawscarf connections --origin https://team.example.com --session-file /private/session list
clawscarf connections --origin https://team.example.com --session-file /private/session catalog
clawscarf connections --origin https://team.example.com --session-file /private/session add outlook
clawscarf connections --origin https://team.example.com --session-file /private/session connect CONNECTION_ID
clawscarf connections --origin https://team.example.com --session-file /private/session usage
```

The private session file contains a currently signed-in administrator's session
credential. No cloud owner token can substitute for native administrator permission.
`connect` prints a link to continue in that signed-in browser; it also resumes existing
setup. `complete` accepts the OAuth receipt in a private file for noninteractive use.
`edit` changes name/grants; `agents`, `refresh`, `cancel` and `disconnect` cover the
remaining account operations. `disconnect` also removes inactive entries. Lists
support `--cursor`, and `list --all` includes disconnected history. Use `--json` for
machine-readable results. Account linking is application management, not installation.
The installer configures the companion's cloud adapter and the native plugin together:

- `{"mode":"disabled"}` makes no broker calls and exposes no Connections UI/tools.
- `{"mode":"hosted"}` enables cloud Connections. Hosted login shares its registration
  when both use the same cloud. With company OIDC, the owner authorizes a separate
  Connections registration; teammates continue using the company's login.

`cloudUrl` and `registrationFile` can be supplied explicitly. The menu retains these
settings when disabling Connections, so re-enabling reuses its existing account and
credentials. Do not delete or replace registration files to retry a failed operation.
Native administrator authority is required for account management. The plugin uses a
separate scoped runtime key and exposes search/describe/call tools. Provider keys never
enter the installation. Account linking happens after login in native Connections.

For an unattended retained change that first enables cloud services, save the candidate
as installation.json in a private candidate directory, then run:

```sh
clawscarf configure --directory ./candidate --cloud-credential-file /private/cloud-owner-key
clawscarf settings plan --config ./candidate/installation.json
clawscarf settings apply --config ./candidate/installation.json --fingerprint PREVIEW_FINGERPRINT --yes
```

Planning itself does not register accounts.
The interactive settings menu performs this same registration before its preview.

The installation contains no local broker or standalone Connections page.

### Packs

Select exact source directories and members:

```json
{
  "packOperator": {
    "pythonExecutable": "/absolute/operator-venv/bin/python",
    "experimentalClaws": true
  },
  "packs": [
    {
      "directory": "/absolute/packs/research-team",
      "members": ["researcher", "reviewer"]
    }
  ]
}
```

Omit `packOperator` when `packs` is empty. Install the pinned Python dependencies
from [requirements.txt](../../scripts/packs/requirements.txt); `doctor` checks SDK
availability. Pack source digests are part of the preview. Model-dependent members
require enabled models. Connection-dependent members additionally require an explicit
private `bindingsFile` using the [pack binding format](../../packs/README.md).
No accounts or grants are invented.

After the protected server starts, each selected member uses native Claws preview
and apply with prerequisite and integrity checks. `status` reports `complete`,
`blocked` or `unconfirmed` per member. These report installation operations, not
continuous observation of native agents. A blocked optional pack leaves the server
available. An uncertain mutation is retained and never automatically replayed.
Successful receipts prevent normal restarts from recreating deleted agents or
replacing native edits. The original source is unnecessary for a completed member's
restart. Explicit settings changes use the same native [pack operations](../../packs/README.md) for updates and removals. Removing a selection invokes native Claws removal, which can trash its workspace,
agent state and sessions as well as remove pack-managed files. Native ownership checks
can retain or block resources. Review removals before applying.

Changing retained configuration is not silently applied by `prepare` or `start`.
The `upgrade` subcommand exposes the existing explicit Gateway-only upgrade; it does
not yet upgrade a complete release. A changed release/configuration that is unsupported
is rejected, not reinitialized. Keep both the state directory and owned data volumes.

Apply, start, upgrade and Connections operations share one exclusive lock beside the
state directory. It covers each configuration/start/stop operation, not the server lifetime; competing
operations return `operation_busy`. Internal preparation and launch do not reacquire it.

### Change an existing installation

```sh
pnpm clawscarf settings --directory ./team
```

The editor reads the accepted configuration from the state directory, including
references to private input files. It reuses the installer sections for
Models, Connections and Packs. Save accepts a section; Esc discards that section;
Esc at the main menu exits without changing the server. Credentials are never shown.
Review and confirm, then the editor stops a running installation, applies the change,
and offers to start it again. There is no separate restart or reconfigure command.

Automation uses the same planner and apply operation:

```sh
node --import tsx scripts/clawscarf.ts settings --directory ./team --json > candidate.json
# Edit candidate.json and its referenced model/credential files.
pnpm clawscarf settings plan --config ./candidate.json
pnpm clawscarf stop --state ./team/state # if running; wait for status to report stopped
pnpm clawscarf settings apply --config ./candidate.json --fingerprint <value> --yes
pnpm clawscarf start --state ./team/state
```

Keep the candidate's referenced files private and available afterward. Successful
application updates that accepted document; ordinary start does not reapply settings.
The menu saves its inputs privately beneath the state directory and removes the
preceding menu draft only after the replacement is accepted.

Supported changes:

- Model catalog, enabled model IDs, default, reasoning, provider routes and keys.
  Bundled LiteLLM keeps the existing scoped key and changes its model permissions
  without unblocking it or extending expiry. Missing keys are not recreated.
  Individual native agent overrides and unrelated OpenClaw settings are preserved.
- Connections enable/disable for the same cloud registration. Disabled
  stops the backend capability and native plugin; accounts, grants and credentials
  remain stored. Re-enabling does not reactivate revoked credentials. The selected
  broker network rule is applied on start without replacing other OpenShell rules.
- Pack selections: unchanged successful members are left alone; additions, updates
  and removals run through native Claws at the next start. `status` reports blocked
  or unconfirmed pack operations. An uncertain pack mutation is never replayed.

Release, identity, addresses, access, resources and execution protection stay fixed.
Changing gateway ownership or moving accounts to another broker/project is a separate
migration. A settings fingerprint includes accepted state and candidate inputs, so a
stale preview cannot apply. If a change is interrupted, startup remains blocked;
inspect the reported stage, then explicitly review and apply the same candidate.
Matching model settings and key permissions are observed before another write.

Verification: a real stopped macOS arm64 installation accepted a new model ID/default
and reasoning setting while retaining its existing LiteLLM key. Native Connections
enable/disable and pack add/update/remove have regression coverage. Connections
enable/disable/re-enable and pack installation also passed with the protected Gateway
and worker running. Native removal of that pack was correctly blocked by an attached
`skill-collection-review` job: the CLI could not authenticate to the serving Gateway
to establish ownership. Pack removal in this trusted-proxy setup therefore remains
a live limitation; the operator leaves the agent intact and reports `blocked`. These
checks do not establish external-account OAuth or Linux/WSL support.
