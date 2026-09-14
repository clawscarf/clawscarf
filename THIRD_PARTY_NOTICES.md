# Third-party provenance and licenses

[LICENSE](LICENSE) applies to ClawScarf-owned work. It does not relicense upstream
software, copied dependencies, assets or provider services.

## Material currently adapted here

AGENTS.md is adapted from RawClaw's contributor guide at commit
[`f37a6e786fdd88857c21bd32140567874e281a8c`](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/AGENTS.md),
with the project owner's authorization. No RawClaw runtime code is incorporated yet.
The reviewed donor has no top-level license file; do not infer a blanket license
for future extraction from OpenClaw's license. Record permission and preserve
embedded third-party notices for each extracted component before publication.

## Upstream components referenced by the design

No OpenClaw, OpenShell or NemoClaw runtime is bundled in this repository yet.
OpenClaw's upstream [license](https://github.com/openclaw/openclaw/blob/main/LICENSE)
is MIT. NVIDIA NemoClaw's [license](https://github.com/NVIDIA/NemoClaw/blob/main/LICENSE)
is Apache-2.0. Referencing their architecture is not incorporating their code.

When bundling or adapting software, record its exact version and source, retain its
license and required notices, and identify modifications where required. Review
plugins, executable dependencies and image contents individually. Publish the actual
component/license inventory with release artifacts; the root MIT license is not
permission to omit third-party requirements. Provider terms are separate from the
license of the client integration.
