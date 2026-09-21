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

You’ll need Docker and a model-provider API key. Check the
[platform requirements](deploy/deployment/installation.md) before installing.

<details>
<summary>Prefer npm?</summary>

```sh
npm install -g @clawscarf/cli@next
clawscarf configure
```

This alternative uses your own Node installation; see the
[requirements](deploy/deployment/installation.md).

</details>

## Make it your team’s workspace

| What you want to do                    | Where to do it                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Start working with an agent**        | Open a chat in OpenClaw. Create and configure agents using its native settings.                                           |
| **Bring in your teammates**            | Open **People**, create an invitation link, and assign native OpenClaw roles. Administrators can remove access there too. |
| **Connect Outlook and other services** | Open **Connections**, link an account, and choose which agents can use it. Choose this optional capability during setup.  |
| **Use your preferred models**          | Choose the provider, model and reasoning level in setup. Run `clawscarf configure` again to change them.                  |

Review the [recipe settings](recipes/README.md) and choose your provider and model.
Usage is billed by your provider; its API key stays outside OpenClaw.

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

See [published releases](https://github.com/clawscarf/clawscarf/releases),
[security implementation](deploy/openshell/README.md),
[browser support](deploy/execution/browser-node/README.md#verified-release-limits)
and [open work](TODO.md) before choosing capabilities. Retained data still needs backups.

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
