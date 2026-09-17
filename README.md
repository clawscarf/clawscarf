# ClawScarf 🧣

**OpenClaw for your team. On your terms.**

ClawScarf packages vanilla [OpenClaw](https://github.com/openclaw/openclaw) with
protected team login, isolated execution, LiteLLM models, optional Connections and
reusable agent packs. Run it on infrastructure you control.

> **Developer preview.** Local login, model/tool use and retained-state restart
> have passed on macOS arm64 with Docker Desktop. This is not yet a qualified
> production release or a downloadable one-command installation.

The selected [hosted login and Connections design](docs/cloud-services.md) replaces
token-only evaluation login with convenient cloud authentication, while retaining
customer OIDC. Connections remains independently optional. The installer now defaults to hosted login, with custom OIDC as an override. The cloud
service has not been deployed; development releases need an explicit cloud URL.
Connections cloud integration remains unfinished.

## What it contains

| Component                                                | Responsibility                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [Runtime](runtime/README.md)                             | Pinned vanilla OpenClaw, native defaults and persistent home. Agents, roles, conversations and configuration stay native.               |
| [OpenShell](deploy/openshell/README.md)                  | Externally controlled protection around the Gateway and separate [execution worker](deploy/execution/worker/README.md).                 |
| [Access](services/access/README.md)                      | Hosted login or generic company OIDC, enrollment, protected entry and session revocation.                                               |
| [Connections](services/connections/README.md) — optional | Account setup, agent grants and a small [search/describe/call plugin](plugins/connections/README.md). External broker or local service. |
| [Models](deploy/models/README.md)                        | Existing LiteLLM or bundled LiteLLM; provider credentials stay outside OpenClaw.                                                        |
| [Packs](packs/README.md) — optional                      | Native agent/skill/workflow bundles with prerequisites and preview; includes a researcher/reviewer example.                             |

Compose runs the OpenShell controller, forwarding services, the
[companion](apps/companion/README.md), PostgreSQL and bundled LiteLLM. OpenShell owns
the protected Gateway and execution worker containers. The CLI starts/stops this stack
and then exits; no host daemon or launchd registration is required. Access and Connections are separate
modules in the companion process. Connections can be omitted entirely. Its native
plugin can also use an external broker. PostgreSQL stores identity/sessions and,
when enabled, connection accounts; it does not duplicate native roles or pack state.

One installation serves **one trusted team**. People have distinct native identities
and roles; execution files and browser accounts may be shared. Different untrusted
teams need separate installations. OpenShell does not make every permitted action
safe or protect against the infrastructure administrator. Native plugins execute
code; MCP and skill visibility are not universal authorization boundaries.

## Run the preview

Follow [contributor setup and builds](scripts/README.md), then the
[installation CLI guide](deploy/deployment/installation.md). The current path requires source
builds, the pinned controller tools, **macOS arm64 and Docker Desktop**. Check the
[measured footprint](deploy/openshell/README.md#development-footprint) before starting.

Loopback installations need no public DNS or VM allocation. Hosted login requires a
ClawScarf account; custom OIDC works independently of the cloud. HTTPS exposure is
configured separately from login.
The installer requires bundled or existing LiteLLM; Connections and packs are optional.
Lower-level component tests can omit models, in which case the Gateway starts with
outbound traffic denied. That policy is not a blanket network policy for every companion.

## Current verification and limits

- Local administrator model responses and file tools passed. Native administrator
  and member execution passed through the separate worker, including administrative
  denial and forbidden network targets.
- The rebuilt development images passed local one-use browser login, native Account/People
  pages and a direct OpenAI GPT-6 Astra response with medium reasoning and a tool call
  through LiteLLM Responses.
- Fresh installer setup passed normal Docker networking, hosted account approval,
  automatic OIDC registration, persistent startup, private administrator claim through
  WorkOS, native People and a real GPT-6 Astra / medium browser response.
- The assembled team profile passed local Dex browser login, enrollment, handover,
  revocation, bookmarks, widgets and hooks. Public deployment and release-artifact
  acceptance remain unqualified.
- Connections has broker/protocol and native plugin tests. Initial unified activation passed with a fixture catalog.
  The real external-account journey still needs acceptance. Disabled operation works
  without provider credentials or a Connections schema.
- Optional [browser-node startup](deploy/execution/browser-node/README.md) uses local
  public-SDK enrollment, private TLS/DNS and retained native identity. Native public
  navigation and full stop/start with retained browser cookies passed.
  Member/administrator explicit-node browsing and revocation passed
  component acceptance. Ordinary model-selected browsing has an owner-managed upstream
  routing bug. Gateway and worker retain OpenShell; Chromium retains its own sandbox.
- Local stopped-runtime replacement preserves the owned volume and has interruption
  tests. Changed-upstream-version upgrades, clean-machine release installation,
  Linux/WSL and automated backups are unfinished.

[TODO.md](TODO.md) contains only open work and future decisions. Lobster and other
optional capabilities are not release requirements. Vanilla ClawHub discovery stays.

## Installation management

The [installation CLI](deploy/deployment/installation.md) is the public configuration and
lifecycle entrypoint, shared by the terminal installer and automation. Recipes provide
defaults for that document. The [component guide](deploy/deployment/README.md) covers internal
developer operations; it is not a second supported installation format.
The menu reviews settings before credentials, starts persistently on macOS when selected, and provides
the private OIDC administrator claim. The `settings` editor and matching plan/apply
commands change retained models, Connections and pack selections; the installation
guide records the native pack-removal limitation. [Release bundles](release/README.md)
copy tools, catalogs and recipe-selected packs into a movable directory. npm/GitHub/GHCR
publication and automatic download remain unfinished.
The bundled [Account and People plugin](plugins/access/README.md) renders inside OpenClaw.
Administrators invite people using copyable links, assign native roles and remove access.
The external Access companion enforces admission and revocation. Connections remains
optional and uses its existing companion page; its native UI rewrite is part of the
selected [hosted-services integration](docs/cloud-services.md).

The unified product design fixes OpenShell Gateway protection, a separate protected
shared worker and authenticated entry/admission/revocation. Recipes vary deployment
settings and optional capabilities, not these protections. The current developer
operator can omit the worker for component work; the unified CLI requires it. External
access remains a proposed verified delegation, never anonymous entry.

OpenClaw retains its mutable application state. Applying selected installation
settings must preserve unrelated native edits. External hosting must supply its own
entry/admission, models and broker without a second login or fleet database.

## Code tour

Start with [apps/companion](apps/companion/README.md) for service composition,
[runtime](runtime/README.md) for native configuration,
[deploy/images](deploy/images/README.md) for images and
[scripts](scripts/README.md) for operator commands. The largest feature is the
optional [Connections backend/UI](services/connections/README.md); Access is separate.
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
