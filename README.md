# ClawScarf 🧣

**OpenClaw for your team. On your terms.**

ClawScarf packages vanilla [OpenClaw](https://github.com/openclaw/openclaw) with
protected team login, isolated execution, optional models and Connections, and
reusable agent packs. Run it on infrastructure you control.

> **Developer preview.** Local login, model/tool use and retained-state restart
> have passed on macOS arm64 with Docker Desktop. This is not yet a qualified
> production release or a downloadable one-command installation.

## What it contains

| Component                                                | Responsibility                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [Runtime](runtime/README.md)                             | Pinned vanilla OpenClaw, native defaults and persistent home. Agents, roles, conversations and configuration stay native.               |
| [OpenShell](deploy/openshell/README.md)                  | Externally controlled protection around the Gateway and separate [execution worker](deploy/execution/worker/README.md).                 |
| [Access](services/access/README.md)                      | Local administrator login or generic company OIDC, enrollment, protected entry and session revocation.                                  |
| [Connections](services/connections/README.md) — optional | Account setup, agent grants and a small [search/describe/call plugin](plugins/connections/README.md). External broker or local service. |
| [Models](deploy/models/README.md) — optional             | Existing model gateway or local LiteLLM; provider credentials stay outside OpenClaw.                                                    |
| [Packs](packs/README.md) — optional                      | Native agent/skill/workflow bundles with prerequisites and preview; includes a researcher/reviewer example.                             |

Compose runs the [companion](apps/companion/README.md) and its PostgreSQL database;
OpenShell owns the Gateway and execution worker. Access and Connections are separate
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
[local operator guide](deploy/local/README.md). The current path requires source
builds, the pinned controller tools, **macOS arm64 and Docker Desktop**. Check the
[measured footprint](deploy/openshell/README.md#development-footprint) before starting.

Local evaluation requires no company IdP, public DNS, cloud account or VM allocation.
The [team profile](deploy/local/README.md#team-profile) adds HTTPS and generic OIDC.
Models, Connections and packs are explicit choices; without model configuration,
the Gateway starts with outbound traffic denied. That policy is not a blanket
network policy for every companion.

## Current verification and limits

- Local administrator model responses and file tools passed. Native administrator
  and member execution passed through the separate worker, including administrative
  denial and forbidden network targets.
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

## Installation management direction

**Initial implementation:** one validated installation document and CLI for local
preparation and lifecycle. A fresh macOS arm64 installation passed local browser login,
administrator bootstrap, protected worker access and stop/restart with native settings
and worker files retained. Initial optional models/Connections and pack selections are implemented; retained-install
capability reconfiguration and publication remain in TODO. The terminal installer
offers release-bundled recipes and revisitable settings, with the same configuration
and preview/apply/start operators available noninteractively;
it requires a prepared release and refuses existing installation directories.
The [installation design and concrete examples](docs/installation-interface.md) define the target
configuration, change semantics, recipes, bootstrap/People choices and the generic external-hosting
boundary. The [unified CLI](deploy/local/installation.md) implements the first configuration/release path;
the [component operator guide](deploy/local/README.md) retains lower-level commands.

The unified product design fixes OpenShell Gateway protection, a separate protected
shared worker and authenticated entry/admission/revocation. Recipes vary deployment
settings and optional capabilities, not these protections. The current developer
operator can omit the worker for component work; the unified CLI requires it. External
access remains a proposed verified delegation, never anonymous entry.

OpenClaw retains its mutable application state. Applying selected installation
settings must preserve unrelated native edits. External hosting must supply its own
entry/admission, models and broker without a second login or fleet database.
[TODO.md](TODO.md) owns unfinished work; the design does not authorize later slices.

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
