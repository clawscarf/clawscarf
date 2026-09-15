# ClawScarf 🧣

**OpenClaw for your team. On your terms.**

Bring your team, models and tools to [OpenClaw](https://github.com/openclaw/openclaw).
ClawScarf packages its native application with company login, optional model and
connection services, and reusable agent packs—on infrastructure you control.
No RawClaw account is required.

> **Developer preview:** a local administrator can sign in, use a configured model
> and tools, and retain their workspace across restarts. This has passed on macOS
> arm64 with Docker Desktop. Shared-team use and an installable release are unfinished.

## Your agents, ready to work together

- **Bring your team.** [Company login and enrollment](services/access/README.md)
  connect to generic OIDC providers. OpenClaw keeps its own application roles;
  ClawScarf provides protected entry and revocable sessions.
- **Share useful setups.** [Agent packs](packs/README.md) bundle native agents,
  skills and workflows. The example pairs a researcher with a reviewer, with
  prerequisite checks and an explicit preview before installation.
- **Choose your models.** Use an existing gateway or the optional
  [LiteLLM companion](deploy/models/README.md). No mandatory OpenRouter account
  or RAW Labs inference service.
- **Connect your tools.** The optional [Connections service](services/connections/README.md)
  lets administrators connect accounts and choose which agents can use them.
  Native plugins, messaging channels and MCP remain available through OpenClaw.
- **Keep the familiar application.** Use OpenClaw's own interface for agents,
  conversations and configuration. ClawScarf packages vanilla upstream releases
  and dependencies; it does not replace the agent engine.

Conversations and workspaces are stored on infrastructure you control. Configured
model and tool providers can receive data you send them.

## Try the developer preview

[Build the components](scripts/README.md), then follow the
[local setup guide](deploy/local/README.md) to prepare and start an installation.
The current path requires **macOS arm64, Docker Desktop, source builds and the
pinned controller executables**. Check the measured
[development footprint](deploy/openshell/README.md#development-footprint) first.

No company identity provider, public DNS, cloud account or separately provisioned
VM is needed for local evaluation. Setup opens a protected native UI. Supply the
optional [initial model configuration](deploy/local/README.md#initial-model-setup)
to use a gateway: preparation configures its scoped credential and network route
together. Without model inputs, the OpenClaw runtime starts with outbound traffic
denied; this policy does not cover companion services.

| Other deployment | Current path                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Standalone team  | The [team profile](deploy/local/README.md#team-profile-under-qualification) assembles HTTPS and company OIDC. The shared deployment journey remains under qualification. |
| RawClaw-managed  | The [integration boundary](PLAN.md#standalone-and-hosted-contracts) is specified. RawClaw does not consume these artifacts yet.                                          |

## What runs

- **OpenClaw runtime:** the native application and installed capabilities inside an
  OpenShell-managed container, with a persistent home volume.
- **Access companion:** local login or company OIDC, enrollment and browser sessions.
  PostgreSQL stores its durable identity and session state.
- **Optional services:** LiteLLM and managed Connections, or existing external
  services providing those capabilities.

Compose runs companions; OpenShell owns the OpenClaw runtime. Packs use native
OpenClaw formats and need no separate database. A hosting platform can supply its
own trusted-ingress identity and omit standalone account navigation.

## Current limits

- Local administrator chat and file-read execution have passed. **Ordinary-member
  shell execution is unavailable, and packaged Chromium cannot launch** under the
  current policy. Their [execution placement](deploy/openshell/README.md#execution-placement)
  still needs resolving.
- Company OIDC and managed Connections have component tests; the complete company-login
  journey and real external-account setup remain unqualified. Native Claws used by
  packs are experimental.
- There is no published all-in-one download or terminal installer. Linux and
  Windows/WSL setup are not supported yet. The [compiled operator archive](scripts/README.md#operator-archive)
  is a local development artifact, separate from runtime and companion images.
- Local runtime replacement has passed interruption/resumption and retained-state
  checks. Cross-version, published-artifact and clean-machine upgrades remain open.

This preview is for technical evaluation, not production team deployment.
[PLAN.md](PLAN.md) tracks the remaining work.

## Security boundaries

One installation serves one trusted team. The OpenShell candidate places the runtime,
including native plugins, under externally controlled filesystem and network policy.
Its Docker driver and application transport have component checks; combined runtime
qualification remains open. Native roles govern application access, and external
services retain shared provider credentials. Sandboxing cannot make every permitted
action safe; an unrestricted administrator remains trusted.

See the [security posture and validation plan](PLAN.md#runtime-candidate-and-security-posture).
ClawScarf is independent—not an official OpenClaw or NVIDIA distribution.

## Get involved

Useful early contributions include runtime compatibility, standalone team setup and
small, testable packs. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [plan](PLAN.md).
Runtime contributors can inspect the [image recipe](deploy/images/Dockerfile),
[sandbox policy](deploy/openshell/policy.yaml) and [component pins](release/components.json).

## License and acknowledgements

ClawScarf-owned work is [MIT licensed](LICENSE), the same license used by
[OpenClaw](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/LICENSE).
Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Built from lessons and reusable work in RawClaw, the Raw Labs OpenClaw pilot,
OpenClaw itself, and NVIDIA's [NemoClaw](https://github.com/NVIDIA/NemoClaw).
