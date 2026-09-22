# Third-party provenance and licenses

[LICENSE](LICENSE) applies to ClawScarf-owned work. It does not relicense upstream
software, copied dependencies, assets or provider services.

The shared [generated HTTP transport](generated/README.md) is emitted unchanged by
`@hey-api/openapi-ts` 0.99.0. Its [MIT license](generated/http/LICENSE.md) accompanies
the operator, companion and Connections plugin artifacts.

## Material currently adapted here

AGENTS.md is adapted from RawClaw's contributor guide at commit
[`f37a6e786fdd88857c21bd32140567874e281a8c`](https://github.com/raw-labs/rawclaw/blob/f37a6e786fdd88857c21bd32140567874e281a8c/AGENTS.md),
with the project owner's authorization. The Connections plugin and companion,
access service, native page flows and development checks also extract or adapt donor
source and regressions. Their local READMEs identify the incorporated paths and
deliberate boundary changes.
The reviewed donor has no top-level license file; do not infer a blanket license
for future extraction from OpenClaw's license. Record permission and preserve
embedded third-party notices for each extracted component before publication.

## Upstream components

The runtime recipe references pinned OpenClaw and OpenShell artifacts in
[release/components.json](release/components.json). The access adapter imports
the published `@openclaw/gateway-client` package. Dependencies and their versions
are recorded in lockfiles. The [downstream patch series](runtime/openclaw/README.md)
contains selected source differences and context from MIT-licensed OpenClaw; it is
not a complete vendored source tree.
The terminal installer uses MIT-licensed `@clack/prompts` 1.8.1. It is installed
from the operator lockfile and retains its upstream license with the dependency;
the installer does not vendor or modify the prompt library.
Standalone CLI archives include the unmodified Node.js 24.19.0 executable from
[official Node downloads](https://nodejs.org/dist/v24.19.0/), verified against the
SHA-256 pins in [release/components.json](release/components.json). Each archive
retains Node's complete upstream LICENSE, including its bundled third-party notices,
at `node/LICENSE`. JavaScript dependencies retain their licenses in `node_modules`.
Gateway and browser-controller source builds apply the maintained patch series to upstream commit
`7bc487d39dc9e059bb9b19ea08152883022f83fe`. Release provenance records the
resulting tree and patch-set digest alongside the exact patches and their intent documents.
The [image build instructions](deploy/images/README.md) own source packaging.
OpenClaw's upstream [license](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/LICENSE)
is MIT. NVIDIA NemoClaw's [license](https://github.com/NVIDIA/NemoClaw/blob/main/LICENSE)
is Apache-2.0. Referencing their architecture is not incorporating their code.
OpenShell 0.0.116 is also [Apache-2.0 licensed](https://github.com/NVIDIA/OpenShell/blob/d1155aa70042d3e2ee49dbfa15346b108b7c1d92/LICENSE).
The pack operator uses the official `openshell` 0.0.116 Python SDK, with its complete
dependency versions and artifact hashes in [requirements.txt](scripts/packs/requirements.txt).
It is installed on the operator machine; no SDK source, controller credentials or
Python environment is copied into the OpenClaw runtime image. Installed dependency
distributions retain their own license metadata.

The runtime builds unmodified nftables 1.1.3 and libnftnl 1.2.9 from official
archives. Their GNU GPL notices are retained in the image. The
[network-tools recipe](deploy/images/network-tools/README.md) owns exact hashes,
build options and the corresponding-source export required for binary releases.
The [browser network](deploy/execution/network/README.md)
uses Squid (GPL-2.0-or-later) and HAProxy (GPL-2.0 with its OpenSSL exception); the relay retains HAProxy's license texts and Debian retains Squid copyright material. The [browser image](deploy/execution/browser/README.md#provenance)
includes a Playwright-derived Apache-2.0 seccomp profile and MIT-licensed `httpxy`;
their notices are retained beside the recipe and inside its image.

The runtime image retains pinned [OpenClaw license](release/licenses/openclaw-MIT.txt)
and [third-party notices](release/licenses/openclaw-THIRD_PARTY_NOTICES.txt), plus
the upstream image's bundled Codex CLI 0.154.0 [license](release/licenses/codex-Apache-2.0.txt) and
[notice](release/licenses/codex-NOTICE.txt), under `/usr/share/licenses/clawscarf`.
These are copied verbatim from their exact upstream revisions, not generated
qualification reports. Debian package copyright files remain under `/usr/share/doc`.
This initial inventory does not establish complete transitive license review;
that release requirement remains in [TODO.md](TODO.md).

The Gateway and companion image recipes copy this file and the root [license](LICENSE)
verbatim to `/usr/share/licenses/clawscarf`. Native plugin pages use the shared
[page renderer](plugins/common/native-page.ts) and OpenClaw's host UI components.
Relative source links in this file refer to the source checkout, not image filesystem paths.

When bundling or adapting software, record its exact version and source, retain its
license and required notices, and identify modifications where required. Review
plugins, executable dependencies and image contents individually. Publish the actual
component/license inventory with release artifacts; the root MIT license is not
permission to omit third-party requirements. Provider terms are separate from the
license of the client integration.

## Extraction source map

Reviewed donor baseline: RawClaw
[`f37a6e786fdd88857c21bd32140567874e281a8c`](https://github.com/raw-labs/rawclaw/tree/f37a6e786fdd88857c21bd32140567874e281a8c).
Recheck the actual donor source when extracting and pin that revision in destination
provenance. Paths below are relative to that donor, not files already present here.

| Capability                            | Donor source to start from                                                                                                          | Adaptation boundary                                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contributor/tooling conventions       | AGENTS.md, eslint.config.mjs, tsconfig*.json, .dependency-cruiser.cjs, scripts/check-docs.ts and contract generation/check tooling  | Preserve standards and meaningful checks; replace donor paths/scripts and omit absent components.                                                            |
| Runtime/defaults and plugin packaging | runtime/openclaw/, deploy/images/hetzner/scripts/install-runtime.sh, plugins/connections/                                           | Reuse defaults, integrity checks and packaging; replace Hetzner, systemd, rootless-engine and host-path assumptions for the selected target.                 |
| Company login and entry               | src/domains/access/, src/domains/installations/service/openclaw/entry/, src/apps/ingress/, src/composition/ingress.ts               | Reuse OIDC/session/ingress mechanics and native identity semantics; replace organization/admission/placement wiring with standalone ownership.               |
| Connections                           | plugins/connections/, src/domains/connections/, src/composition/connections/, catalogs/connections/, scripts/connectors-catalog*.ts | Preserve REST tools, Composio adapter, callbacks, account selection and grants; extract required persistence without the fleet control plane.                |
| Connection account UI                 | src/apps/web/domains/connections/                                                                                                   | Adapt the account-management flow to native OpenClaw plugin pages and generated clients; omit the donor web shell.                                           |
| Model gateway                         | runtime/ai-gateway/, deploy/ai-gateway/, src/composition/ai/ and applicable src/domains/ai/ code                                    | Reuse LiteLLM integration/configuration and tests; replace hosted-source/admission/catalog wiring where needed. Do not recreate the removed inference proxy. |
| Acceptance                            | tests/ and corresponding helpers for identity, logout, ingress, native roles, connections, model gateway and browser flows          | Transfer regressions with each capability; adapt fixtures and run against the new runtime. Donor success is not new-target acceptance.                       |

The OpenShell forwarding image packages Alpine Linux, OpenSSH and lsof through Alpine's
package manager, plus the checksum-verified upstream OpenShell 0.0.116 Linux CLI.
Package license metadata is retained in the image. OpenShell is Apache-2.0;
see [upstream license](https://github.com/NVIDIA/OpenShell/blob/d1155aa70042d3e2ee49dbfa15346b108b7c1d92/LICENSE).

## Connector logos

The Connections UI includes logos from the catalog’s `logos.composio.dev` URLs,
packaged as image assets. These identify the respective services; their trademarks
remain owned by their respective owners. The refresh script retains each source URL
in the [packaged icons](plugins/connections/assets/icons.json).
