# ClawScarf — initial plan

This is the single initial design and implementation checklist. The repository
is implementing the runtime boundary and extracting donor components. An initial
pinned image recipe and deny-by-default policy exist; the standalone distribution
is not yet qualified. The terminal installer is last. Build and validate the
underlying components first.

## Product and boundaries

ClawScarf is an independently usable OpenClaw team distribution. The adoption goal
is a local container-based installation with a short terminal setup flow, without
requiring a VM, RawClaw account, cloud-provider account, GPU or company OIDC merely
to try it. A team deployment adds protected shared access and company identity.
One installation contains multiple people, native roles and agents in one trusted
team boundary. Separate untrusted teams use separate installations.

OpenClaw owns its native application and mutable configuration. ClawScarf owns the
tested runtime combination, dependencies, integration packaging and operating
procedures. RawClaw will consume ClawScarf artifacts and retain organizations, hosting,
provisioning, admission, optional billing and infrastructure lifecycle. The website
is a future separate repository under the same parent/organization.

## Runtime candidate and security posture

The proposed local architecture places the complete OpenClaw runtime and native
plugins inside an OpenShell-managed sandbox. A host-side controller owns its
lifecycle and policy. Compose may run companion services; it must not compete
with OpenShell for ownership of the same runtime container.

This is different from enabling OpenClaw's own OpenShell sandbox backend, which
delegates selected execution while leaving the Gateway outside that sandbox.
Evaluate current upstream releases, then pin the exact tested combination. Do not
design around RawClaw's deployed OpenClaw version or silently upgrade deployments.

The intended added protection is externally enforced filesystem, process and
network restrictions around the runtime, including native plugin code. It depends
on the selected platform, mounts, policy and credential paths. Verify denied access,
not just successful startup. OpenShell does not establish native user permissions,
safe business actions, immunity to prompt injection or protection from host root.
Administrators may edit native application configuration within deployment limits;
they must not gain controller credentials or change host-owned policy from inside.

Current validation found that whole-runtime containment leaves shell execution in
the Gateway's loopback namespace. Trusted-proxy identity headers are therefore not
a member boundary against unrestricted local execution. Selection and qualification
of a separate native execution sandbox remain part of the first milestone; ordinary
member shell access must stay denied until that boundary is verified. The runtime
packaging decision is awaiting owner input, not silently replaced.
The [execution-placement review](deploy/openshell/README.md#execution-placement)
records the supported worker options and their actual credential requirements.

Keep shared model/connection provider credentials outside OpenClaw. Limited runtime
credentials remain credentials and require tested scoping and revocation. A broker
governs calls through itself, not every native plugin, channel, CLI or MCP service.
OAuth, menu hiding and tool discovery restrictions are not universal enforcement.

The first validation must resolve whether whole-runtime containment, native Codex
permissions, browser isolation and Lobster work together. Do not enable nested
sandboxing indiscriminately or weaken isolation to make a smoke test pass. If the
candidate fails an essential requirement, report the concrete tradeoff before
replacing the architecture. Target operating systems/architectures remain to be
qualified; do not advertise Linux/macOS/WSL equivalence from container availability.

## Repository responsibilities

Create these directories when they contain real work; this is not empty scaffolding.

```text
release/             Exact tested component versions and integrity references
runtime/             Native configuration templates and runtime payload
plugins/             Our OpenClaw extensions, including Connections
packs/               Optional agents, skills, workflows and dependency bindings
services/access/     Reused generic login, entry and session-revocation integration
services/connections/ Optional extracted broker and account-management surface
deploy/openshell/    Runtime definition and externally owned policies
deploy/compose/      Companion-service composition
deploy/images/       Runtime and capability dependency image recipes
tests/               Installation, access, capability and upgrade acceptance
docs/                Focused user/operator documentation as it becomes necessary
cli/                 Operating commands, then the interactive terminal wizard
installer/           Small release-download/bootstrap script, built last
```

No full upstream OpenClaw source copy, RawClaw fleet database or second native-role
database. Postgres may support extracted companions' durable sessions/accounts;
justify its actual owners during extraction. Do not introduce it for pack metadata.

## Standalone and hosted contracts

Independence must be demonstrated, not inferred from a configurable service URL.

| Deployment       | Identity and admission                                                                                                     | Models and Connections                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Local evaluation | Loopback-only protected local administrator enrollment; no company IdP or public DNS required.                             | Operator-supplied model gateway or optional local LiteLLM. Connections may be absent.                         |
| Standalone team  | Local access companion connected to company OIDC; explicit authorized-user enrollment and native role assignment.          | Existing external services or optional locally operated companions with customer credentials.                 |
| RawClaw-managed  | RawClaw supplies current identity/admission authority and native acting-user context. No second independent SSO authority. | RawClaw supplies its model gateway and broker; its hosted authorization/accounting remains outside ClawScarf. |

Before extracting access, define one durable server identity, stable issuer/subject
mapping, explicit first-administrator enrollment, authorization of additional people,
handover and revocation. OIDC authentication alone does not admit everyone from an
IdP. Use native user/role controls where adequate and a narrow extracted access
surface where required; never fake organization, allocation or Hetzner records to
satisfy donor dependencies. Reuse the narrow ingress/session-check boundary rather
than copying the fleet-dependent entry service unchanged.

Define the local endpoint map before the installer: native UI, login/callback,
widgets, optional account UI and provider callbacks. Verify loopback origins/ports,
browser cookie isolation and redirects without a RawClaw hostname. Shared mode
adds configured names/TLS; public exposure requires working authentication.

Optional Connections needs standalone account setup/return, plugin activation and
scoped runtime credentials. External-broker mode must require neither a local broker
database nor local Composio credentials. Optional LiteLLM needs local key provisioning
and revocation without RawClaw's internal admission callback. Retain native state,
server identity, user mapping and companion account/key material across restart or
container recreation. Stopping a deployment must not delete its data.

RawClaw adoption requires an explicit runtime-target contract, separate from its
server/volume/allocation facts: exact artifact, endpoint/transport, persistent paths,
identity context and supported operations. Its adapter retains hosted authorization
and uses the selected runtime controller from outside the sandbox. Existing root-only
SSH launchers, ZFS binding checks, systemd units and fixed bridge addresses are not
portable runtime interfaces. Preserve user-scoped management and uncertain outcomes;
do not replace them with a shared all-powerful identity to simplify integration.

The reviewed donor uses UID 2000 and `/opt/rawclaw`, while this image uses UID 1000
and persistent `/home/node`. Adoption must map data ownership, trusted ingress and
the hosted inference source address deliberately. The local controller disables bind
mounts and uses a Docker named home volume; adopting that unchanged would not put
native state on RawClaw's existing installation data volume. Define and test the
hosted mount arrangement while retaining allocation/volume fencing; do not silently
move persistent state to the VM's disposable root disk. Preserve the running plugin's
credential-generation verification when replacing systemd-based checks. RawClaw's
existing identity, broker and LiteLLM remain the owners in hosted mode; do not deploy
duplicate standalone companions for those responsibilities. The current release
manifest lists Darwin arm64 controller artifacts; Linux x86-64 artifacts and runtime
qualification are prerequisites for Hetzner adoption, not an assumed image switch.

## Remaining implementation and qualification

Completed component work lives in its implementation owner, not in this checklist.
The [model integration](deploy/models/README.md), for example, has its operational
configuration path and component acceptance; it still participates in the combined
fresh-install qualification below. Continue following the reuse map and contributor
rules for every remaining change.

- [ ] **1. Prove the runtime boundary.** Select current OpenClaw/OpenShell versions;
      build a pinned vanilla runtime image and reproducible non-interactive launch.
      Verify persistence, restart, networking, resource limits, model/tool streaming,
      and native UI/widget reachability. Test forbidden host paths, unrelated data,
      controller/socket access and forbidden egress. Record actual platform limits,
      download size, cold-start/install time and measured idle/active memory. Do not
      assume the current small RawClaw VM can run the new stack unchanged.
- [ ] **2. Define the shipped capability baseline.** Inventory selected native
      plugins, skills, CLI dependencies, channels and MCP paths with exact execution
      location and authority. Compare executable defaults and tests from RawClaw and
      the pilot. Qualify ordinary execution, native Codex, browser automation and
      Lobster where promised; do not confuse their different sandbox mechanisms.
      Preinstalled, enabled, visible and allowed-to-execute are separate properties.
- [ ] **3. Complete independent access.** Reuse RawClaw's working identity/ingress
      implementation through a standalone composition. Deliver protected loopback-only
      local administrator setup and generic company OIDC for shared deployment. Explicit
      first administrator; native roles thereafter, no first-login takeover. Verify two
      identities, role denial/handover, stable display identities, direct bookmarks,
      multiple tabs, logout/revocation of open streams, widgets and authenticated hooks.
      Qualify the standalone identity and endpoint contracts above. Do not require a
      RawClaw account or expose remote access without working identity.
- [ ] **5. Complete optional managed Connections.** Reuse the current generic REST
      plugin and broker; no MCP rewrite. Extract independent account setup/management
      and required persistence, with Composio behind its provider boundary. Support an
      external broker or locally deployed companion. Preserve exact account selection,
      agent grants, revocation and explicit outcomes. Verify trusted caller context;
      do not advertise per-human or per-operation authorization not actually enforced.
      Unconfigured integration has no unusable tools or dead-end actions. Keep native
      MCP, channels and other plugins as separate supported integration paths.
- [ ] **7. Complete curation and configuration.** Support selected capability
      enable/disable through native interfaces. Qualify hiding ClawHub/unselected
      discovery independently of execution restrictions. Use supported UI extension
      points; if a patch is necessary, obtain a maintenance decision rather than quietly
      weakening the requirement. Keep native administration and explicit reapplication;
      no background overwrite daemon or duplicate OpenClaw dashboard.
- [ ] **8. Qualify release operation.** Document persistent paths, secret handling,
      stop/start, logs, diagnostics and one supported upgrade preserving native edits.
      Assemble one reproducible noninteractive setup sequence for controller, volume,
      native state, Postgres/migrations, private credentials, companions and forwarding;
      separate component commands are not a complete installation path. The
      [local assembly](deploy/local/README.md) has verified fresh preparation,
      supervised launch, native administrator login and retained-state restart.
      Complete model/tool and interrupted-allocation acceptance before qualifying
      the whole setup path. Include model selection, scoped credentials and the
      matching network permission in that qualification: the current local setup
      initializes no model and starts with outbound traffic denied. A successful
      browser login alone does not establish an agent ready to do useful work.
      Test missing/invalid optional services and interrupted setup. Produce exact
      artifacts with license/provenance review. Full backups and rollback automation
      remain outside this work; make no data-recovery promise from an image rebuild.
      Run a clean-machine acceptance from release artifacts without RawClaw source,
      account, API, database or hostname: protected login, real model/tool response,
      retained state after restart and clean operation with integrations disabled.
      Qualify team OIDC and optional broker account setup separately.
- [ ] **9. Build the terminal installer last.** A small verified-download bootstrap
      invokes a maintained terminal UI over the already-working commands. Offer local
      trial, team server and existing-install configuration. Prompt for exposure/login,
      models and optional packs/account bindings, with concise ASCII-style presentation,
      masked secrets, dependency review, visible progress, actionable errors and resume.
      Finish with the actual usable URL and operating commands. Support unattended
      configuration without embedding secrets in argv or baked artifacts. Do not
      duplicate native agent onboarding or require the wizard for ordinary operation.
      Follow the packaging lessons below rather than silently compiling from source
      or replacing an existing installation when a release download/setup fails.

## Adoption and packaging lessons

Use NemoClaw's practical patterns without copying its entire orchestration stack:

- Release artifacts and a documented platform/resource matrix, separate from the
  contributor checkout. Default to a tested release with exact image integrity;
  source builds are explicit, not a hidden fallback after a failed download.
- Inspect an existing installation and distinguish configure/resume/upgrade/new.
  Show a real first successful model/tool interaction, not only process readiness.
- Treat model endpoint configuration and its required network policy as one setup
  choice. Optional integrations need their own explicit destinations; installing a
  plugin or supplying a key does not authorize egress. Recheck current state when
  resuming setup rather than relying on an earlier success marker.
- Check ports and container-network capacity before changing resources. Report
  startup stages, use bounded readiness checks and retain enough state to resume.
  Print the actual application URL and operating commands only after their checks
  succeed; optional-service warnings must not masquerade as a failed core startup.
- Keep reproducible unattended commands beneath the eventual terminal wizard.
  Provide agent-readable instructions without asking users to put secrets in chat.
- Measure our selected stack. NemoClaw's resource figures and platform claims do
  not automatically apply to ClawScarf. Verify runtime-controller topology from the
  selected release rather than assuming a Docker install has no other components.
- Publish actual screenshots/demo, working quickstart, support matrix and release
  checksums when available. No fake download commands, passing badges or security
  claims. Keep the README welcoming and capability-oriented while marking status.

See [NemoClaw's quickstart](https://docs.nvidia.com/nemoclaw/user-guide/openclaw/get-started/quickstart)
and [prerequisites](https://docs.nvidia.com/nemoclaw/user-guide/openclaw/get-started/prerequisites).

## Deferred or undecided

- [ ] Before publication, verify extracted-code rights and bundled dependency
      licenses/notices, configure an actual private vulnerability-reporting channel,
      and choose repository/release settings. ClawScarf-owned work uses [MIT](LICENSE);
      [third-party provenance](THIRD_PARTY_NOTICES.md) does not grant blanket rights
      to donor code or change dependencies' licenses.
- [ ] Have RawClaw consume qualified ClawScarf artifacts in a separately selected integration
      slice; preserve current deployments and avoid duplicate maintained defaults.
      Qualify one new managed installation using external RawClaw identity/model/broker
      services, native mutation/stream/widget behavior, connector context, source-bound
      AI authorization and revocation. Transfer runtime/default/image ownership after
      success, not while the new target is still unqualified.
- [ ] Decide additional supported platforms from evidence, not a blanket promise.
- [ ] Website, billing, fleet management, additional hosting providers and automated
      recovery/backups are separate future work. ZFS is not a distribution prerequisite.
- [ ] Stronger operation-level company policy and cross-tool audit guarantees need
      explicit requirements; do not infer them from MCP, OpenShell or connection grants.

## RawClaw reuse map

**Copy/extract working code and its tests, then adapt the composition.** This is the
default for existing capabilities, not merely inspiration. New OpenShell packaging
and pack lifecycle work have no equivalent proven RawClaw implementation; use
upstream mechanisms for those. Do not transplant the native systemd/Docker layout
as if it already qualified the proposed whole-runtime boundary.

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
| Connection account UI                 | src/apps/web/domains/connections/ and its shared visual/form dependencies                                                           | Copy the working flow and visual primitives; remove organization routing through explicit standalone composition.                                            |
| Model gateway                         | runtime/ai-gateway/, deploy/ai-gateway/, src/composition/ai/ and applicable src/domains/ai/ code                                    | Reuse LiteLLM integration/configuration and tests; replace hosted-source/admission/catalog wiring where needed. Do not recreate the removed inference proxy. |
| Acceptance                            | tests/ and corresponding helpers for identity, logout, ingress, native roles, connections, model gateway and browser flows          | Transfer regressions with each capability; adapt fixtures and run against the new runtime. Donor success is not new-target acceptance.                       |

Preserve licenses/notices and identify each intentional omission. Copy no secrets,
customer state or per-run reports. Keep RawClaw functioning during extraction; its
switch to shared ClawScarf artifacts is a separately authorized integration step.
Do not turn that temporary transition into permanently duplicated runtime ownership.

## References

Reference current upstream, pin the selected release for implementation:

- [NemoClaw architecture](https://docs.nvidia.com/nemoclaw/user-guide/openclaw/about/how-it-works)
  demonstrates whole-runtime containment and external policy/credential ownership.
- [OpenClaw OpenShell backend](https://docs.openclaw.ai/gateway/openshell) is the
  distinct native execution-backend integration.
- [OpenClaw security](https://docs.openclaw.ai/gateway/security),
  [skills](https://docs.openclaw.ai/tools/skills) and
  [Lobster](https://docs.openclaw.ai/tools/lobster) describe trust and capability limits.
- Local donor checkout `/Users/miguel/raw-labs/rawclaw` supplies the reuse map above.
  This path is developer-local evidence, not a public installation dependency.
- Local pilot `/Users/miguel/raw-labs/claw/docs/sandboxing.md`: native Codex,
  filesystem visibility and browser isolation acceptance. Its past findings must
  be rerun against the newly selected runtime; do not copy old workarounds blindly.

Earlier ClawScarf discussions live in the RawClaw draft specification. This plan
owns the new repository's implementation direction; old proposed native-VM-first
packaging and installer-first ordering do not override the decisions above.
