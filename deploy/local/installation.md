# Unified installation CLI

The unified CLI composes the existing [local operators](README.md). It requires
OpenShell, the protected shared worker and authenticated entry. The current target
is macOS arm64 with Docker Desktop. Published downloads, the interactive installer,
local LiteLLM lifecycle and pack selection are unfinished.

A fresh local installation passed preparation, native browser administrator login,
worker SSH execution as UID 1000, stop, repeated preparation and restart. Native
appearance settings and worker files survived; the worker had no Gateway configuration.
This qualifies the local disabled-capability path, not optional-service or published
release installation. Interrupted preparation resumed after Docker network capacity
was restored without replacing its recorded installation identity.

## Development release

Build components using their [image recipes](../images/README.md). Generate a
release file from an existing complete component input (including the worker and
relay); this is a build command, not an alternative customer configuration:

```sh
pnpm clawscarf release-create --input /absolute/built-components.json \
  --output /absolute/clawscarf-release.json --version 0.1.0-dev \
  --source-revision <full-source-commit> --openshell-version 0.0.116
```

The release file pins images, executable checksums and supported platforms. Tool
file paths resolve relative to the release file. It contains no installation secrets.
The current generator refers to local executable files; it does not publish/download
release tools or qualify a release. Local image IDs work for development only.

## Configure and run

Installation paths resolve relative to the installation configuration file. Secret
files must be regular, private files owned by the operator. A minimal example:

```json
{
  "schemaVersion": 1,
  "name": "team",
  "releaseFile": "./clawscarf-release.json",
  "stateDirectory": "./state",
  "storage": { "mode": "docker-volumes" },
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
  "models": { "mode": "disabled" },
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
`login` creates a new local login code; company deployments use their configured IdP.

Company HTTPS/OIDC uses the existing explicit administrator subject/email bootstrap;
new enrollment UX is undecided. Browser use retains the documented upstream limitation.
Optional initial model configuration uses the existing HTTPS gateway path. Connections
configuration can be validated, but plan/apply reject it until unified activation is
implemented; use the existing component operator for now. Nonempty pack selections, local LiteLLM,
external platform access and directory-backed storage are rejected by this initial schema.

Changing retained configuration is not silently applied by `prepare` or `start`.
The `upgrade` subcommand exposes the existing explicit Gateway-only upgrade; it does
not yet upgrade a complete release. A changed release/configuration that is unsupported
is rejected, not reinitialized. Keep both the state directory and owned data volumes.
