# ClawScarf 🧣

**OpenClaw for your team. On your terms.**

ClawScarf packages vanilla [OpenClaw](https://github.com/openclaw/openclaw) with
protected team login, a confined team runtime, LiteLLM models, optional Connections and
reusable agent packs. Run it on infrastructure you control.

> **Developer preview.** OIDC login, model/tool use and retained-state restart
> have passed on macOS arm64 with Docker Desktop. This is not yet a qualified
> production release. The first alpha is available through npm and GitHub Releases.

The installer defaults to ClawScarf hosted login, with customer OIDC as an override.
Connections is independently optional and uses its native OpenClaw page and cloud broker.
Cloud staging and production are deployed through build/promotion. Real Outlook linking,
reconnect, tool execution and revocation passed locally. The current runtime's
verification and remaining integration limits are described below.

## What it contains

| Component                                                | Responsibility                                                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Runtime](runtime/README.md)                             | Pinned vanilla OpenClaw, native defaults and persistent home. Agents, roles, conversations and configuration stay native.                                |
| [OpenShell](deploy/openshell/README.md)                  | Externally controlled protection around the complete team runtime: Gateway, plugins, shell and local tools.                                              |
| [Access](services/access/README.md)                      | Hosted login or generic company OIDC, enrollment, protected entry and session revocation.                                                                |
| [Connections](services/connections/README.md) — optional | Account setup, agent grants and a small [search/describe/call plugin](plugins/connections/README.md). Cloud broker with installation-scoped credentials. |
| [Models](deploy/models/README.md)                        | Existing LiteLLM or bundled LiteLLM; provider credentials stay outside OpenClaw.                                                                         |
| [Packs](packs/README.md) — optional                      | Native agent/skill/workflow bundles with prerequisites and preview; includes a researcher/reviewer example.                                              |

Compose runs the OpenShell controller, forwarding services, the
[companion](apps/companion/README.md), PostgreSQL and bundled LiteLLM. OpenShell owns
the protected team runtime container. The CLI starts/stops this stack
and then exits; no host daemon or launchd registration is required. Access and the optional Connections management adapter run in the companion process. Connections can be omitted entirely. Its native
plugin can also use an external broker. PostgreSQL stores identity/sessions and,
when enabled, connection accounts; it does not duplicate native roles or pack state.

One installation serves **one trusted team**. Gateway, native plugins, Lobster,
ordinary shell commands and local tools run together inside the same OpenShell
boundary. They share the persistent home filesystem. Default agent work happens
in `/home/node/.openclaw/workspace`; other native agents can have their own
workspaces on that filesystem. Browser accounts are shared through the separate
browser service.

People keep native identities and roles for ordinary application permissions.
Anyone allowed to execute code must be trusted with Gateway authority, including
its local configuration, sessions and runtime credentials. These roles do not
isolate hostile teammates from administrators. OpenShell protects the surrounding
host and services; Access, controller credentials, Docker authority, original
model-provider keys and Connections management credentials stay outside. External
revocation stops authenticated entry; it cannot undo a process or persistent change
already made inside the runtime. Different untrusted teams need separate installations.

## Run the preview

Requires **macOS arm64, Docker Desktop and Node 24.16+ (24.x) or 26.1+**.

```sh
npm install -g @clawscarf/cli@next
clawscarf configure
```

The alpha package includes recipes and downloads their pinned runtime tools/images.
See the [installation CLI guide](deploy/deployment/installation.md) and
[measured footprint](deploy/openshell/README.md#development-footprint) before starting.
For source builds, use [contributor setup](scripts/README.md).

Loopback installations need no public DNS or VM allocation. Hosted login requires a
ClawScarf account; custom OIDC works independently of the cloud. HTTPS exposure is
configured separately from login.
The installer requires bundled or existing LiteLLM; Connections and packs are optional.
Lower-level component tests can omit models, in which case the Gateway starts with
outbound traffic denied. That policy is not a blanket network policy for every companion.

## Current verification and limits

- The single runtime passed native chat upload → file read → Python → Lobster,
  PDF extraction, Lobster approval/resume, member permissions and persistent restart
  with a deterministic model fixture. Shell and Lobster remained confined by
  OpenShell. Reproduction and limits are in the
  [OpenShell guide](deploy/openshell/README.md#repeatable-boundary-and-retention-check).
- Prior component and assembly checks passed OIDC administrator setup, native Account/People
  pages and a direct OpenAI GPT-6 Astra response with medium reasoning and a tool call
  through LiteLLM Responses.
- Fresh installer setup passed normal Docker networking, hosted account approval,
  automatic OIDC registration, persistent startup, private administrator claim through
  WorkOS, native People and a real GPT-6 Astra / medium browser response.
- The assembled team profile passed local Dex browser login, enrollment, handover,
  revocation, bookmarks, widgets and hooks. Public deployment remains unverified.
- Connections has broker/protocol and native plugin tests. Initial unified activation passed with a fixture catalog.
  Real Outlook linking, execution, reconnect and revocation passed locally. Disabled operation works
  without provider credentials or a Connections schema.
- Optional [browser-node startup](deploy/execution/browser-node/README.md) uses local
  public-SDK enrollment, private TLS/DNS and retained native identity. Native public
  navigation and full stop/start with retained browser cookies passed.
  Member/administrator explicit-node browsing and revocation passed
  component acceptance. Ordinary model-selected browsing has an owner-managed upstream
  routing bug. The team runtime retains OpenShell; Chromium retains its own sandbox.
- Local stopped-runtime replacement preserves the owned volume and has interruption
  tests. Changed-upstream-version upgrades, Linux/WSL and automated backups are unfinished.

The `0.1.0-alpha.1` packaged CLI passed a fresh installation on the development Mac:
staging hosted login, native administrator setup, a real GPT-6 Astra response and
stop/start with retained chat history. Published runtime downloads passed checksum
verification separately. This was not a newly provisioned host.

[TODO.md](TODO.md) contains only open work and future decisions. Native Lobster is
a required capability. Built-in plugin/skill curation and removal of ClawHub mentions
are a separate selected direction; this execution-model change does not implement them.
The [OpenClaw curation review](runtime/curation.md) records configuration limits,
UI/backend ownership, packaging choices and downstream patch considerations.

## Installation management

The [installation CLI](deploy/deployment/installation.md) is the public configuration and
lifecycle entrypoint, shared by the terminal installer and automation. Recipes provide
defaults for initial configuration. The [component guide](deploy/deployment/README.md) covers internal
developer operations; it is not a second supported installation format.
The menu reviews settings before credentials, starts persistently on macOS when selected, and provides
the private OIDC administrator claim. The same `configure` command changes
retained models, Connections and pack selections, interactively or with explicit flags; the installation
guide records the supported changes. [Recipes](recipes/README.md) ship with the CLI and pack files; each pins a reusable
[runtime release](release/README.md) containing exact images and tools.
[0.1.0-alpha.1](https://github.com/clawscarf/clawscarf/releases/tag/v0.1.0-alpha.1)
is published through npm, GitHub Releases and public GHCR images.
The bundled [Account and People plugin](plugins/access/README.md) renders inside OpenClaw.
Administrators invite people using copyable links, assign native roles and remove access.
The external Access companion enforces admission and revocation. Connections remains
optional and renders its native page inside OpenClaw; its backend runs in the cloud.

Every recipe retains the same outer protection and authenticated entry/admission/
revocation. Recipes select resources, models and capabilities. CLI dependencies
belong in the runtime image; a document recipe may eventually select an enriched
image without introducing a second execution filesystem. Current recipes use one
runtime image per release. External access remains a proposed verified delegation,
never anonymous entry.

OpenClaw retains its mutable application state. Applying selected installation
settings must preserve unrelated native edits. External hosting must supply its own
entry/admission, models and broker without a second login or fleet database.

## Code tour

Start with [apps/companion](apps/companion/README.md) for service composition,
[runtime](runtime/README.md) for native configuration,
[deploy/images](deploy/images/README.md) for images and
[scripts](scripts/README.md) for operator commands. The largest feature is the
[Access service](services/access/README.md). The [Connections adapter](services/connections/README.md)
and native plugin call the separately deployed cloud backend.
[Component pins](release/components.json) identify upstream versions.

An external hosting platform may supply identity, model gateway and broker instead
of the standalone services. It must integrate the
[hosted runtime boundary](runtime/README.md#external-hosting-boundary); that consumer
integration is future work, not a runtime dependency.

## Contribute and license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). ClawScarf-owned work
is [MIT licensed](LICENSE); incorporated material retains its licenses and
[attribution](THIRD_PARTY_NOTICES.md). ClawScarf is independent, not an official
OpenClaw or NVIDIA distribution.
