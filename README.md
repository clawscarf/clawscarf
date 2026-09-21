<a href="https://clawscarf.com"><img src="https://clawscarf.com/clawscarf-mark.svg" alt="ClawScarf logo" width="112" height="112" /></a>

# ClawScarf

### OpenClaw, ready for your team.

Give your team a shared OpenClaw server—with individual logins, your choice of AI
models, connected accounts, and execution protected by NVIDIA OpenShell.
**Self-hosted. Open source. OpenClaw’s own interface.**

[Get started](#get-started) · [Installation guide](deploy/deployment/installation.md) · [Releases](https://github.com/clawscarf/clawscarf/releases) · [Contribute](CONTRIBUTING.md)

## Get started

```sh
curl -fsSL https://github.com/clawscarf/clawscarf/releases/download/v0.1.0-alpha.4/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
clawscarf configure
```

**Choose Team server. Pick a model. Sign in. Start your server.**

The terminal setup walks you through it, downloads the runtime, and opens OpenClaw
in your browser. Your sign-in becomes the first administrator account. No checkout,
Docker configuration files or separate OpenClaw installation required.

You’ll need **Docker Engine 29+ with Compose** (or Docker Desktop) and an **API key
for your chosen model provider**. The CLI includes its own Node runtime.
Available for **macOS Apple Silicon and Linux ARM64/x86-64**; Windows runs through
**WSL2, currently experimental**. Add `~/.local/bin` to your shell's PATH to keep
the command available in new terminals. The installer requires no sudo.
[Full platform requirements →](deploy/deployment/installation.md)

<details>
<summary>Prefer npm?</summary>

```sh
npm install -g @clawscarf/cli@next
clawscarf configure
```

This alternative uses your own Node installation: Node 24.16+ within 24.x or 26.1+.
The `next` tag installs the current alpha.

</details>

## Make it your team’s workspace

| What you want to do                    | Where to do it                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Start working with an agent**        | Open a chat in OpenClaw. Create and configure agents using its native settings.                                                                       |
| **Bring in your teammates**            | Open **People**, create an invitation link, and assign native OpenClaw roles. Administrators can remove access there too.                             |
| **Connect Outlook and other services** | Open **Connections**, link an account, and choose which agents can use it. Connections is included in Team server and can be turned off during setup. |
| **Use your preferred models**          | Choose the provider, model and reasoning level in setup. Run `clawscarf configure` again to change them.                                              |

The default recipe uses **GPT-6 Astra through OpenAI, with medium reasoning**.
Choose another provider or model in the menu; usage is billed by your provider.
Your provider API key stays outside OpenClaw, in the model gateway.

Setup opens **[http://127.0.0.1:18800](http://127.0.0.1:18800)** by default.
That address is local to your machine. To share the server with teammates, use a
reachable HTTPS address; the [installation guide](deploy/deployment/installation.md#configuration-options)
covers the public URL and company SSO settings.

OpenShell applies filesystem and network policy to the whole OpenClaw runtime,
including plugins, shell commands and local tools. Recipes bring login, models and
optional Connections together in one setup; you keep OpenClaw’s native agents,
conversations, skills and settings.

## Everyday commands

```sh
clawscarf status       # Check the server
clawscarf stop         # Stop it, keeping your data
clawscarf start        # Start it again
clawscarf configure    # Change its configuration
```

The default installation directory is `~/clawscarf-team`. Use
`--directory ~/another-team` to create or manage a separate installation.
Chats, files and settings survive stop/start. Closing the terminal leaves the server
running; Docker must stay running while it is in use.

For automation, the same configuration choices are available as command-line flags
with `--non-interactive`, and commands support `--json`.
[CLI reference and examples →](deploy/deployment/installation.md#configure-without-prompts)

## Your server, your team

An installation serves **one trusted team**: separate logins and roles, shared
execution files and browser accounts. Native roles control application permissions;
people allowed to run code share the Gateway’s authority. Use separate installations
for teams that must be isolated from one another.

Default login and optional Connections use **ClawScarf Cloud**. You can use your own
OIDC provider and disable Connections to run without those hosted services. Original
model-provider keys and Connections management credentials stay outside OpenClaw.

ClawScarf is in alpha. Browser automation is off by default pending release
qualification; retained data still needs backups. See the [security boundaries](deploy/openshell/README.md),
[browser support](deploy/execution/browser-node/README.md) and [open work](TODO.md)
for details.

## Explore and contribute

- **Using ClawScarf:** [Installation](deploy/deployment/installation.md) · [People](plugins/access/README.md) · [Connections](plugins/connections/README.md) · [Models](deploy/models/README.md)
- **Customizing it:** [Recipes](recipes/README.md) · [Packs](packs/README.md) · [Runtime architecture](runtime/README.md)
- **Helping build it:** [Contributing](CONTRIBUTING.md) · [Development setup](scripts/README.md) · [Report a bug](https://github.com/clawscarf/clawscarf/issues)

ClawScarf maintains a small [OpenClaw patch series](runtime/openclaw/README.md)
for selected fixes and optional capabilities. Releases include its exact source provenance.

Built on [OpenClaw](https://github.com/openclaw/openclaw),
[NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) and
[LiteLLM](https://github.com/BerriAI/litellm).
[MIT licensed](LICENSE), with [third-party notices](THIRD_PARTY_NOTICES.md).
ClawScarf is an independent project.
