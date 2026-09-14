# ClawScarf 🧣

**Your team's OpenClaw. Your infrastructure.**

ClawScarf is building an open-source team edition of
[OpenClaw](https://github.com/openclaw/openclaw): company login, useful capability
packs, your choice of models, and connections to the services your team uses.
A coherent installation you can run yourself, without a RawClaw account.

> **Early development:** this repository currently contains the design and
> contributor guidance. There is no runnable distribution or installer yet.
> Follow the [implementation plan](PLAN.md) for the work remaining.

## What we're building

- **A team server.** Multiple people and agents, company OIDC login and native
  OpenClaw roles. The native OpenClaw UI remains the everyday application.
- **Packs that arrive prepared.** Selected agents, skills, plugins and workflows
  with their actual dependencies and connection requirements accounted for.
- **Models on your terms.** Use an existing model gateway or an optional LiteLLM
  deployment. No mandatory OpenRouter account or RAW Labs inference service.
- **Connections where you need them.** Optional managed account connections,
  alongside native plugins, messaging channels, CLI tools and MCP.
- **A practical local start.** A container-based installation without requiring
  you to arrange a VM. Build the working runtime first, then a polished terminal
  installer with optional packs and resumable setup.

## Security with explicit boundaries

The proposed OpenShell integration contains the whole OpenClaw runtime, including
native plugins, under externally controlled filesystem and network policy. This
combination still needs qualification; it is not a released security guarantee.

One installation serves one trusted team. Native roles control application access;
external services retain shared provider credentials. Sandboxing cannot make every
permitted action safe, and an unrestricted administrator remains trusted.
See the [security posture and validation plan](PLAN.md#runtime-candidate-and-security-posture).

## Independent by design

ClawScarf is intended to work on its own. RawClaw is a separate management and
hosting product that can consume the same runtime artifacts. Standalone users
must not need its portal, organization database, billing or cloud credentials.

OpenClaw owns the application; ClawScarf packages and tests the combination.
We are building on its supported interfaces and existing formats, not a parallel
agent engine. ClawScarf is an independent project, not an official OpenClaw or
NVIDIA distribution.

## Get involved

The most useful early contributions are testing runtime compatibility, improving
standalone team setup and defining a small set of useful, testable packs.
Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [plan](PLAN.md).
Installation commands, screenshots and platform claims will appear when verified.

## License and acknowledgements

ClawScarf-owned work is [MIT licensed](LICENSE), the same license used by
[OpenClaw](https://github.com/openclaw/openclaw/blob/main/LICENSE).
Third-party components retain their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Built from lessons and reusable work in RawClaw, the Raw Labs OpenClaw pilot,
OpenClaw itself, and NVIDIA's [NemoClaw](https://github.com/NVIDIA/NemoClaw).
