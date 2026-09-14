# ClawScarf 🧣

**Your team's OpenClaw. Your infrastructure.**

Bring your team, models and tools to [OpenClaw](https://github.com/openclaw/openclaw).
ClawScarf packages its native application with company login, optional model and
connection services, and reusable agent packs—on infrastructure you control.

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
Component build and test instructions are available now. A complete installation
guide and supported-platform claims wait for clean-install qualification.

Runtime contributors can inspect the [image recipe](deploy/images/Dockerfile),
[sandbox policy](deploy/openshell/policy.yaml) and [component pins](release/components.json).

## License and acknowledgements

ClawScarf-owned work is [MIT licensed](LICENSE), the same license used by
[OpenClaw](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/LICENSE).
Third-party components retain their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Built from lessons and reusable work in RawClaw, the Raw Labs OpenClaw pilot,
OpenClaw itself, and NVIDIA's [NemoClaw](https://github.com/NVIDIA/NemoClaw).
