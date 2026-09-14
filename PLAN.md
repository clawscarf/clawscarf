# ClawScarf — initial plan

This is the single initial design and implementation checklist. Repository setup
is the currently authorized slice; the work below is planned, not implemented.
The terminal installer is last. Build and validate the underlying components first.

## Product and boundaries

ClawScarf is an independently usable OpenClaw team distribution. The adoption goal
is a local container-based installation with a short terminal setup flow, without
requiring a VM, RawClaw account, cloud-provider account, GPU or company OIDC merely
to try it. A team deployment adds protected shared access and company identity.
One installation contains multiple people, native roles and agents in one trusted
team boundary. Separate untrusted teams use separate installations.

OpenClaw owns its native application and mutable configuration. ClawScarf owns the
tested runtime combination, dependencies, integration packaging and operating
procedures. RawClaw consumes ClawScarf artifacts and owns organizations, hosting,
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

## Implementation order

- [ ] **1. Prove the runtime boundary.** Select current OpenClaw/OpenShell versions;
  build a pinned vanilla runtime image and reproducible non-interactive launch.
  Verify persistence, restart, networking, resource limits, model/tool streaming,
  and native UI/widget reachability. Test forbidden host paths, unrelated data,
  controller/socket access and forbidden egress. Record actual platform limits.
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
  Do not require a RawClaw account or expose remote access without working identity.
- [ ] **4. Complete model integration.** Support an existing compatible gateway
  and optional bundled LiteLLM configuration. Keep provider credentials outside the
  runtime. Test a real response and tool call, model discovery/defaults, failures,
  and unconfigured operation. Provider selection stays extensible; OpenRouter is
  not mandatory. No AI credits, organization inheritance or billing in this slice.
- [ ] **5. Complete optional managed Connections.** Reuse the current generic REST
  plugin and broker; no MCP rewrite. Extract independent account setup/management
  and required persistence, with Composio behind its provider boundary. Support an
  external broker or locally deployed companion. Preserve exact account selection,
  agent grants, revocation and explicit outcomes. Verify trusted caller context;
  do not advertise per-human or per-operation authorization not actually enforced.
  Unconfigured integration has no unusable tools or dead-end actions. Keep native
  MCP, channels and other plugins as separate supported integration paths.
- [ ] **6. Implement packs.** Use upstream Claws/bundles where they fit. A pack may
  contain several agents, skills, plugins and workflows; bind models and connections
  separately from secrets. Define required binaries, execution locations, network
  permissions, compatibility and owned files/settings. Implement install, inspect,
  explicit update/reapply and removal with dependency checks and preservation of
  user changes/data. Qualify one representative pack before expanding the catalog.
- [ ] **7. Complete curation and configuration.** Support selected capability
  enable/disable through native interfaces. Qualify hiding ClawHub/unselected
  discovery independently of execution restrictions. Use supported UI extension
  points; if a patch is necessary, obtain a maintenance decision rather than quietly
  weakening the requirement. Keep native administration and explicit reapplication;
  no background overwrite daemon or duplicate OpenClaw dashboard.
- [ ] **8. Qualify release operation.** Document persistent paths, secret handling,
  stop/start, logs, diagnostics and one supported upgrade preserving native edits.
  Test missing/invalid optional services and interrupted setup. Produce exact
  artifacts with license/provenance review. Full backups and rollback automation
  remain outside this work; make no data-recovery promise from an image rebuild.
- [ ] **9. Build the terminal installer last.** A small verified-download bootstrap
  invokes a maintained terminal UI over the already-working commands. Offer local
  trial, team server and existing-install configuration. Prompt for exposure/login,
  models and optional packs/account bindings, with concise ASCII-style presentation,
  masked secrets, dependency review, visible progress, actionable errors and resume.
  Finish with the actual usable URL and operating commands. Support unattended
  configuration without embedding secrets in argv or baked artifacts. Do not
  duplicate native agent onboarding or require the wizard for ordinary operation.

## Deferred or undecided

- [ ] Select public licensing and repository publication settings before publishing.
- [ ] Consume qualified artifacts from RawClaw in a separately selected integration
  slice; preserve current deployments and avoid duplicate maintained defaults.
- [ ] Decide additional supported platforms from evidence, not a blanket promise.
- [ ] Website, billing, fleet management, additional hosting providers and automated
  recovery/backups are separate future work. ZFS is not a distribution prerequisite.
- [ ] Stronger operation-level company policy and cross-tool audit guarantees need
  explicit requirements; do not infer them from MCP, OpenShell or connection grants.

## References and reusable work

Reference current upstream, pin the selected release for implementation:

- [NemoClaw architecture](https://docs.nvidia.com/nemoclaw/user-guide/openclaw/about/how-it-works)
  demonstrates whole-runtime containment and external policy/credential ownership.
- [OpenClaw OpenShell backend](https://docs.openclaw.ai/gateway/openshell) is the
  distinct native execution-backend integration.
- [OpenClaw security](https://docs.openclaw.ai/gateway/security),
  [skills](https://docs.openclaw.ai/tools/skills) and
  [Lobster](https://docs.openclaw.ai/tools/lobster) describe trust and capability limits.
- Local donor checkout `/Users/miguel/raw-labs/rawclaw`: runtime/openclaw,
  plugins/connections, identity/ingress and provider domains, deploy recipes and
  existing regression tests. Record exact commits when extracting; this path is
  developer-local evidence, not a public installation dependency.
- Local pilot `/Users/miguel/raw-labs/claw/docs/sandboxing.md`: native Codex,
  filesystem visibility and browser isolation acceptance. Its past findings must
  be rerun against the newly selected runtime; do not copy old workarounds blindly.

Earlier ClawScarf discussions live in the RawClaw draft specification. This plan
owns the new repository's implementation direction; old proposed native-VM-first
packaging and installer-first ordering do not override the decisions above.
