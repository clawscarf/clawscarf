# ClawScarf 🧣

**OpenClaw for your team. On your terms.**

Bring your team, models and tools to [OpenClaw](https://github.com/openclaw/openclaw).
ClawScarf packages its native application with company login, optional model and
connection services, and reusable agent packs—on infrastructure you control.

Use OpenClaw's own interface to work with your agents. Add company identity,
connect your team's tools and share useful setups through packs. Conversations and
workspaces are stored on infrastructure you control; configured model and tool
providers can receive data you send them. No RawClaw account is required.

> **Early development:** components are implemented and undergoing integration testing.
> There is no qualified distribution, complete quickstart or installer yet.
> Follow the [implementation plan](PLAN.md) for the work remaining.

## What's in the repository

- **[Team access](services/access/README.md).** Generic OIDC, protected local login,
  enrollment and revocable sessions. OpenClaw owns application roles and remains
  the everyday UI.
- **[Agent packs](packs/README.md).** Native OpenClaw Claws grouped into reusable
  packs, with explicit previews, prerequisite checks and preservation of user edits.
  The example pairs a researcher with a reviewer; native Claws are experimental.
- **[Models on your terms](deploy/models/README.md).** Configure an existing model
  gateway or the optional LiteLLM companion. No mandatory OpenRouter account or
  RAW Labs inference service.
- **[Managed connections](services/connections/README.md).** Optional account setup,
  agent grants and a small discovery/description/call plugin. Native plugins,
  messaging channels and MCP remain OpenClaw capabilities.
- **[A pinned runtime](deploy/images/README.md).** Vanilla OpenClaw with Codex,
  Lobster, Chromium and ClawScarf plugins packaged together. Dependencies being
  installed does not mean every execution path is qualified.

The intended installation is container-based, without a separately provisioned VM.
The terminal installer comes after the underlying components work together.

## Start here

| Your goal               | Current path                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Try it locally          | [Build the components](scripts/README.md), then [prepare and start a local installation](deploy/local/README.md). Protected browser login and retained-state restart have passed. |
| Run it for a team       | [Company OIDC and enrollment](services/access/README.md) are implemented; the shared-deployment journey and member execution still need qualification.                            |
| Host it through RawClaw | The integration boundary is [specified](PLAN.md#standalone-and-hosted-contracts); RawClaw does not consume these artifacts yet.                                                   |

Local setup opens the protected native UI without requiring a provider account.
To use a model, separately [configure the model gateway](deploy/models/README.md)
and authorize its network route. Fresh setup denies outbound traffic by default.
The configured local installation has passed an administrator browser conversation
with a real model and native file-read tool. This is a developer evaluation path,
not a finished end-user quickstart or shared-team qualification.

The current runtime checks target **macOS arm64 with Docker Desktop**. Linux and
Windows/WSL are not yet qualified. See the measured
[development footprint](deploy/openshell/README.md#development-footprint) before
building.

The installation has three parts:

- **OpenClaw runtime:** the native application and installed capabilities, running
  inside an OpenShell-managed container with a persistent home volume.
- **Access companion:** local login or company OIDC, enrollment and browser sessions,
  with PostgreSQL for durable identity and session state.
- **Optional services:** LiteLLM and managed Connections, or existing external
  services that provide those capabilities.

Compose runs companions; OpenShell owns the OpenClaw runtime. Packs use native
OpenClaw formats and do not need their own database.

## Security with explicit boundaries

The OpenShell candidate places the whole OpenClaw runtime, including native
plugins, under externally controlled filesystem and network policy. Its Docker
driver and application transport have component-level checks; the combined runtime
still needs qualification. Browser sandboxing and member execution remain open.

One installation serves one trusted team. Native roles control application access;
external services retain shared provider credentials. Sandboxing cannot make every
permitted action safe, and an unrestricted administrator remains trusted.
See the [security posture and validation plan](PLAN.md#runtime-candidate-and-security-posture).

## Independent by design

The standalone components do not depend on RawClaw's portal, organization database,
billing or cloud credentials. A hosting platform can supply its own trusted-ingress
identity and omit standalone account navigation. RawClaw adoption is a separate,
future integration; it does not consume this runtime yet.

OpenClaw owns the application; ClawScarf packages and tests the combination.
We are building on its supported interfaces and existing formats, not a parallel
agent engine. ClawScarf is an independent project, not an official OpenClaw or
NVIDIA distribution.

## Get involved

The most useful early contributions are testing runtime compatibility, improving
standalone team setup and defining a small set of useful, testable packs.
Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [plan](PLAN.md).

Runtime contributors can inspect the [image recipe](deploy/images/Dockerfile),
[sandbox policy](deploy/openshell/policy.yaml) and [component pins](release/components.json).

## License and acknowledgements

ClawScarf-owned work is [MIT licensed](LICENSE), the same license used by
[OpenClaw](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/LICENSE).
Third-party components retain their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Built from lessons and reusable work in RawClaw, the Raw Labs OpenClaw pilot,
OpenClaw itself, and NVIDIA's [NemoClaw](https://github.com/NVIDIA/NemoClaw).
