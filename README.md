# ClawScarf 🧣

**Run OpenClaw for your team, on infrastructure you control.**

ClawScarf is an open-source distribution of [OpenClaw](https://github.com/openclaw/openclaw)
with team login, protected execution, model configuration and optional connections
to services such as Outlook. Install it from npm, follow the terminal setup, then
work in OpenClaw’s own interface.

- **Bring your team:** invite people, assign native OpenClaw roles and revoke access.
- **Bring your model:** choose a provider and model, then supply your API key.
- **Connect your accounts:** link external services and choose which agents can use them.
- **Keep execution contained:** NVIDIA OpenShell protects the team runtime, including
  its Gateway, plugins, shell commands and local tools.

> **Alpha preview.** The published `0.1.0-alpha.1` supports macOS Apple Silicon with
> Docker Desktop. Linux ARM64/x86-64 and WSL2 support is being prepared for the next
> alpha; it is not available in the published package yet.

## Get started

Have these ready:

- **Docker Desktop**, installed and running on an Apple Silicon Mac.
- **Node.js** 24.16+ within the 24.x series, or 26.1+.
- **An LLM provider API key.** The Team server recipe defaults to OpenAI GPT-6 Astra
  with medium reasoning; you can choose another model/provider during setup.
  Model usage is billed by your provider.

Install the CLI and launch setup:

```sh
npm install -g @clawscarf/cli@next
clawscarf configure
```

No repository checkout, recipe file or separate OpenClaw installation is needed.
The CLI includes the recipe catalog and downloads the selected runtime’s tools and
Docker images. The first installation can take several minutes.

1. Choose **Team server** and review its settings. Connections is enabled by default;
   you can turn it off. Accept the settings, then enter the selected provider’s key.
2. Follow the browser link to **sign in or create a ClawScarf account** and approve
   the installation. That account becomes its first administrator. You can choose
   your company’s OIDC provider instead during setup.
3. Let setup start the server. It opens OpenClaw at **[http://127.0.0.1:18800](http://127.0.0.1:18800)**
   by default. Start a chat, invite teammates through **People**, or link an account
   through **Connections**.

The installation directory defaults to `~/clawscarf-team`. To choose another location,
use `clawscarf configure --directory ~/my-team`. The server keeps running after the
terminal closes; Docker must remain running.

The default address is accessible only on your machine. To let teammates reach the
server remotely, configure HTTPS and a reachable address using the
[installation guide](deploy/deployment/installation.md). Hosted login does not make
your local server publicly accessible.

## Manage your server

These commands use the same default installation directory:

```sh
clawscarf status
clawscarf stop
clawscarf start
clawscarf logs --service companion
clawscarf configure
```

`stop` preserves your data; `start` resumes the installation. Use `configure` to
change model, Connections or pack settings.

If you chose a different directory, add `--directory ~/my-team` to each command.
For scripts and coding agents, configuration choices are also available as explicit
flags with `--non-interactive`; use `--json` for machine-readable output. See
[CLI options and examples](deploy/deployment/installation.md#configure-without-prompts).

## How it fits together

OpenClaw owns agents, conversations, roles, tools and application settings. ClawScarf
adds authenticated entry and session revocation, OpenShell runtime protection, and
model routing through bundled or external LiteLLM. Provider keys stay outside OpenClaw.
Account, People and optional Connections pages appear inside OpenClaw.

Docker Compose runs the supporting services; OpenShell runs the protected OpenClaw
container. The CLI manages them without installing a host daemon. Chats, files and
settings persist across stop/start. **Persistence is not a backup**; automated backups
and upgrades across upstream versions remain unfinished.

Hosted login and the optional Connections broker use ClawScarf Cloud. Company OIDC
works independently of hosted login, and Connections can be disabled entirely.
[Recipes](recipes/README.md) supply editable defaults and pin the runtime version;
optional [packs](packs/README.md) add groups of native agents, skills and workflows.
Recipes always retain authenticated access and OpenShell protection.

## Team and security boundaries

Each installation is for **one trusted team**, with separate native identities and
roles but shared execution files and browser accounts. Members permitted to execute
code must be trusted with Gateway authority, including its runtime credentials.
Native roles do not isolate hostile teammates from each other or from administrators;
use separate installations for mutually untrusted teams.

Access, Docker/controller credentials, original model-provider keys and Connections
management credentials remain outside the protected runtime. Revoking access stops
entry and active authenticated connections; it cannot undo code already executed or
changes already made inside the runtime.

Browser automation is optional and off by default. Explicit browser-node use has
passed tests, but automatic browser selection still has an upstream routing issue.
See [browser support](deploy/execution/browser-node/README.md) and
[OpenShell protection and limits](deploy/openshell/README.md) before enabling it.

## Documentation and help

- [Installation guide](deploy/deployment/installation.md): configuration, company SSO,
  automation, lifecycle commands and deletion.
- [Models](deploy/models/README.md), [People](plugins/access/README.md) and
  [Connections](plugins/connections/README.md): feature configuration and behavior.
- [Runtime architecture](runtime/README.md) and [service composition](apps/companion/README.md):
  implementation and integration boundaries.
- [Releases](https://github.com/clawscarf/clawscarf/releases) and [open work](TODO.md):
  available downloads and remaining work.
- [Report a bug](https://github.com/clawscarf/clawscarf/issues): include your CLI version,
  operating system and relevant logs, with credentials removed.

## Contributing and license

See [contributor setup](scripts/README.md), [CONTRIBUTING.md](CONTRIBUTING.md) and
[AGENTS.md](AGENTS.md). ClawScarf-owned code is [MIT licensed](LICENSE); bundled
components retain their [licenses and attribution](THIRD_PARTY_NOTICES.md).
ClawScarf is independent, not an official OpenClaw or NVIDIA distribution.
