# Third-party provenance and licenses

[LICENSE](LICENSE) applies to ClawScarf-owned work. It does not relicense upstream
software, copied dependencies, assets or provider services.

## Material currently adapted here

AGENTS.md is adapted from RawClaw's contributor guide at commit
[`f37a6e786fdd88857c21bd32140567874e281a8c`](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/AGENTS.md),
with the project owner's authorization. The Connections plugin and companion,
access service, UI primitives and development checks also extract or adapt donor
source and regressions. Their local READMEs identify the incorporated paths and
deliberate boundary changes.
The reviewed donor has no top-level license file; do not infer a blanket license
for future extraction from OpenClaw's license. Record permission and preserve
embedded third-party notices for each extracted component before publication.

## Upstream components

The runtime recipe references pinned OpenClaw and OpenShell artifacts in
[release/components.json](release/components.json). The access adapter imports
the published `@openclaw/gateway-client` package. Dependencies and their versions
are recorded in lockfiles; upstream source is not vendored here.
OpenClaw's upstream [license](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/LICENSE)
is MIT. NVIDIA NemoClaw's [license](https://github.com/NVIDIA/NemoClaw/blob/main/LICENSE)
is Apache-2.0. Referencing their architecture is not incorporating their code.
OpenShell 0.0.116 is also [Apache-2.0 licensed](https://github.com/NVIDIA/OpenShell/blob/d1155aa70042d3e2ee49dbfa15346b108b7c1d92/LICENSE).

The runtime image retains pinned [OpenClaw license](release/licenses/openclaw-MIT.txt)
and [third-party notices](release/licenses/openclaw-THIRD_PARTY_NOTICES.txt), plus
Codex CLI 0.153.4's [license](release/licenses/codex-Apache-2.0.txt) and
[notice](release/licenses/codex-NOTICE.txt), under `/usr/share/licenses/clawscarf`.
These are copied verbatim from their exact upstream revisions, not generated
qualification reports. Debian package copyright files remain under `/usr/share/doc`.
This initial inventory does not establish complete transitive license review;
that release requirement remains in the plan.

When bundling or adapting software, record its exact version and source, retain its
license and required notices, and identify modifications where required. Review
plugins, executable dependencies and image contents individually. Publish the actual
component/license inventory with release artifacts; the root MIT license is not
permission to omit third-party requirements. Provider terms are separate from the
license of the client integration.
