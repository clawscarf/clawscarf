# Unified installation CLI

The unified CLI composes the existing [local operators](README.md). It requires
OpenShell, the protected shared worker and authenticated entry. The current target
is macOS arm64 with Docker Desktop. Published downloads remain unfinished. The
terminal installer covers initial setup. Required LiteLLM, optional Connections and pack selections
are wired into initial preparation and startup.

A fresh local installation passed preparation, native browser administrator login,
worker SSH execution as UID 1000, stop, repeated preparation and restart. Native
appearance settings and worker files survived; the worker had no Gateway configuration.
These are component checks; they do not qualify the current recipe installer or a published release. Interrupted preparation resumed after Docker network capacity
was restored without replacing its recorded installation identity.

The optional assembly also passed local preparation and startup with bundled LiteLLM,
a fixture Connections catalog and both research-pack agents. Private-TLS inference
passed against a controlled upstream; invalid keys, unauthorized models and runtime-key
administration were denied. Repeated preparation and restart retained a native UI edit,
pack receipts and revoked model/Connections credentials. This workstation had exhausted
Docker's default network pool, so that run resumed using explicitly addressed, owned
test networks. It does not qualify default network allocation on an exhausted host,
external account OAuth, or paid provider inference for this assembly.

## Development release

Build components using their [image recipes](../images/README.md). Generate a
release file from explicit built-component inputs:

```sh
pnpm clawscarf release-create --input /absolute/built-components.json \
  --output /absolute/clawscarf-release.json
```

The input follows the [release contract](../../scripts/release/definition.ts):
`schemaVersion`, `version`, `sourceRevision`, `platforms`, `images`, `recipes` and `tools`.
Use exact image digests, the pinned PostgreSQL/LiteLLM images, and recipe objects from
[deploy/recipes](../recipes/README.md). Under `tools.openshell`, provide `version` and
`cli`/`gateway` as executable file paths relative to the input file; the builder computes
checksums and writes absolute paths. No administrator, secrets, ports or installation
state are release inputs. Output creation refuses to overwrite an existing release.

The release file pins images, executable checksums and supported platforms. Tool
file paths resolve relative to the release file. It contains no installation secrets.
The current generator refers to local executable files; it does not publish/download
release tools or qualify a release. Local image IDs work for development only.

## Configure and run

### Terminal installer

From the checkout, with an already prepared release:

```sh
pnpm clawscarf install --release /absolute/clawscarf-release.json --directory ./team
```

Without `--release`, the operator looks for **clawscarf-release.json** in its
**release** directory. No published bundle exists yet: development uses
an explicit release from `release-create`, which now embeds the recipe catalogue.
There is no release-path prompt or software-source menu. `--recipes <directory>`
replaces that catalogue for development; `--recipe <id>` skips the starting-point picker.
The directory must be new and its parent must exist. The installer requires an interactive
terminal and the release's exact local images/OpenShell executables; it does not build
or download missing components.

Choose a recipe: it supplies the initial model catalog and other defaults. Enter only
missing provider keys, then review the summary. **Customize** opens Name and administrator,
Access, Models, Connections, Packs, Resources and (when packaged) Browser.
**Custom** starts in that detailed menu and requires a model catalog.
Connections defaults to off. Security foundations and LiteLLM are required.

**Esc** returns to the parent screen throughout setup; there are no Back menu rows.
Within a section it discards unsaved edits and new secrets, returning to Customize.
Customize returns to review; review returns to recipes. At the starting-point menu,
Esc stays there. **Save section changes** accepts edits; accepted answers survive
back navigation. **Ctrl+C** exits. Final save/action choices also support Esc;
files are written only after those choices are accepted.

This describes the implemented menu. The [next installation design](../../docs/installation-interface.md#the-installation-experience)
puts the settings menu before secrets and makes Esc exit at the first screen; those
changes are not implemented yet.

The illustrative **Team documents** recipe supplies GPT-6 Astra through OpenRouter,
with medium thinking. It does not supply a document assistant, ingestion or a
qualified document workflow. Its live provider journey remains unverified.

OIDC currently requires DNS/TLS, a registered client and the known administrator's
subject/email. The private one-use authenticated owner-claim flow is selected future
work, not implemented by this menu. Local mode retains its one-use login code.
The Access section shows the actual login and post-logout callback URLs.

Advanced model catalog imports, connector catalogues and pack sources retain their existing file
formats; this menu does not create external accounts or conduct account OAuth.
Secret prompts offer masked entry or private-file import. LiteLLM can collect each
provider key required by the selected route file, or import its private environment file.
TLS private keys and pack binding documents use file import. Entered secrets stay
in memory until confirmation; only secrets referenced by the final configuration are
saved. Files go into a private `secrets/` directory (0700), with credentials and
configuration/preview at 0600. Ordinary configuration and notes contain no secret values.
Recipe/generated model catalogs are copied to models.json. Other input paths remain absolute
references; keep those files available.

After confirming file creation, it validates inputs and saves the normal CLI preview.
Choose **Save preview and exit**, **Prepare installation**, or **Prepare and start**.
Save-only does not call Docker or provision resources. Preparation first runs `doctor`
and applies that exact preview. Start uses the ordinary foreground supervisor and its
readiness/login output; Ctrl+C stops it and retains data. Cancellation during a long
preparation step waits for that operation to settle and prevents the next step from
starting. Failures retain saved files and show CLI resumption instructions; mutations
are never automatically retried.

The installer refuses existing directories, including empty ones or symlinks. Resume
through the CLI below; unified retained-install capability changes are still unfinished.
The wizard's save-only path is exercised in a real terminal. Automated tests cover
revisiting sections, recipe/CLI equivalence, optional feature removal, private files,
preview integrity and delegation/order for prepare/start;
they do not constitute a new full runtime or OIDC qualification.

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
  "access": { "mode": "local", "administratorName": "Sam" },
  "models": { "mode": "litellm", "upstreamEnvironmentFile": "./providers.env" }
}
```

The same `--settings` file can be supplied to `install`; complete supplied sections
skip their questions. The example uses the recipe's model catalog and a private
providers.env containing OPENROUTER_API_KEY. Without a recipe catalog, Models must
also supply configurationFile. Noninteractive configuration rejects missing credentials
or disabled Models before writing files; it never prompts. Credentials belong in private
files, not literal command-line arguments. Precedence is recipe defaults, settings overrides,
then accepted interactive edits.

Use `--recipe custom` for the same baseline without a recipe. Input-file references in
settings resolve against that file; generated state remains relative to the new
installation. The saved configuration records recipe ID/release as provenance only:
subsequent startup does not reload or inherit changing recipe definitions.
Continue with `validate`, `doctor`, `plan`, `apply` and `start` below. These remain
the authority for actual file, runtime and dependency verification. All CLI configuration
and operation results are JSON; interactive presentation is separate.

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
  "access": { "mode": "local", "administratorName": "Administrator" },
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

Start remains in the foreground, prints progress and a one-use local login code,
and stops on Ctrl+C. In another terminal:

```sh
pnpm clawscarf status --state ./state
pnpm clawscarf stop --state ./state
pnpm clawscarf logs --state ./state --service controller
pnpm clawscarf login --state ./state
```

The local control socket is private to the operator and never listens on TCP.
`stop` requests orderly shutdown; poll `status` to observe supervisor exit. An absent
supervisor is not proof that every container stopped after a crash. `logs` prints
the last 100 lines of an allowlisted private operator log; treat logs as private.
`logs --help` lists controller/forward and all Compose exit-monitor log names.
Service application output remains available through Compose logs.
`login` creates a new local login code; company deployments use their configured IdP.

Company HTTPS/OIDC uses the existing explicit administrator subject/email bootstrap;
new enrollment UX is undecided. Browser use retains the documented upstream limitation.
Optional modes are described below. External platform access and directory-backed
storage remain unsupported.

## Optional capabilities

All paths resolve against the installation document. LiteLLM is required, either bundled
or externally operated. Disabled Connections
creates no Connections database schema and exposes no connector tools.

### Models

- `{"mode":"external","configurationFile":"models.json","credentialFile":"secrets/model-key"}`
  uses an existing HTTPS LiteLLM gateway; optional `caFile` supplies private trust.
  Under Customize, the installer asks for the LiteLLM API URL and its scoped key;
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

- `{"mode":"disabled"}` omits the broker and native tool configuration.
- `{"mode":"external","brokerUrl":"https://broker.example.com","credentialFile":"secrets/connections-key"}`
  initializes the plugin against an existing broker; optional `caFile` supplies trust.
  Supply an installation-scoped broker token, not a Composio project key.
- `{"mode":"local","projectId":"YOUR_PROJECT","apiKeyFile":"secrets/composio-key","catalogDirectory":"catalog"}`
  enables the existing companion service and its schema/catalog. Preparation issues
  the initial scoped runtime credential once and configures the plugin on a fresh
  native volume. Composio credentials stay in the companion. Repeated preparation
  never replaces an existing credential or reactivates a revoked one.

Use the [catalog importer](../../services/connections/README.md) to prepare catalog
files. Installation does not contact Composio or connect anybody's account. The
provider project callback still must match the deployed Connections URL, and account
OAuth is a subsequent human action. The plugin exposes the existing three
search/describe/call tools; agent grants remain managed through Connections.

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
restart. Native pack update/removal remains an explicit [pack operation](../../packs/README.md).

Changing retained configuration is not silently applied by `prepare` or `start`.
The `upgrade` subcommand exposes the existing explicit Gateway-only upgrade; it does
not yet upgrade a complete release. A changed release/configuration that is unsupported
is rejected, not reinitialized. Keep both the state directory and owned data volumes.

Apply, start, upgrade and Connections operations share one exclusive lock beside the
state directory. It covers initial creation and the full foreground lifetime; competing
operations return `operation_busy`. Internal preparation and launch do not reacquire it.
