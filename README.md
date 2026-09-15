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
- Connections has broker/protocol and native plugin tests. The assembled activation
  and real external-account journey still need acceptance. Disabled operation works
  without provider credentials or a Connections schema.
- **Browser operator integration is unfinished.** The private [browser-node assembly](deploy/execution/browser-node/README.md)
  passed native member/administrator browsing with explicit node selection, TLS/DNS,
  retained device identity and revocation after restart. Initial enrollment still needs
  an authenticated administrator through Access; localhost trusted-proxy bootstrap is
  rejected upstream. Gateway and worker retain OpenShell. Browser remains opt-in.
- Local stopped-runtime replacement preserves the owned volume and has interruption
  tests. Changed-upstream-version upgrades, clean-machine release installation,
  Linux/WSL, automated backups and the terminal installer are unfinished.

[TODO.md](TODO.md) contains only open work and future decisions. Lobster and other
optional capabilities are not release requirements. Vanilla ClawHub discovery stays.

## Installation management direction

**Planned, not yet a unified interface:** one ClawScarf CLI manages one installation
from a validated JSON document and referenced private secret files. It will compose
existing operator modules rather than introduce a second orchestrator. Configuration
covers runtime/artifact selection, storage/resources, exposure/TLS, local or OIDC
access, initial administrator, execution/browser, optional models/Connections and
selected packs/capabilities. Native agent/role/conversation state remains in OpenClaw;
the installation document is not a mirror of every native setting.

Initial setup establishes the administrator and proves login. Ongoing enrollment
and removal belong in People; role definitions and assignments remain native.
Authentication never automatically admits everyone from an identity provider.

The CLI should validate and preview changes, prepare/start/stop, report status and
logs, diagnose failures and perform explicit reconfiguration/upgrades. Retain native
edits by default; show replacement/restart consequences before applying selected
changes. Secret rotation and uncertain effects must not be silently replayed.
A terminal wizard comes last and calls these same operations.

Development uses explicitly selected local builds; releases use a manifest with
verified artifact references. Both run the same implementation with installation
state outside the executable package. There is no silent source-build fallback.
Connections stays optional in the existing companion for now; extracting a separate
process/authentication arrangement needs its own decision. See [TODO.md](TODO.md)
for the ordered work and current browser blocker.

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
