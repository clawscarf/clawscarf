# OpenClaw curation

Keep native team chat, agents, files, tools and administration. Supply only selected
built-ins, with no unwanted marketplace discovery or setup. Administrators can
still deliberately add plugins, skills and MCP servers. Native Lobster is required;
People is mandatory and Connections optional.

This document owns the product selection and implementation constraints.
[TODO.md](../TODO.md#openclaw-curation) is the actionable checklist.
The source review uses OpenClaw **2026.9.4**, commit
`7bc487d39dc9e059bb9b19ea08152883022f83fe`, pinned in
[components.json](../release/components.json). Recheck the selection when upgrading.

## Current status

“Implemented” means present in this repository, not necessarily published.

| Item                                                                                   | Mechanism                       | Status                                                                                                   |
| -------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Remove Discord community invitation                                                    | Existing configuration          | Implemented: `gateway.controlUi.communityInvite: false`                                                  |
| Disable operator terminal                                                              | Existing configuration          | Implemented: `gateway.terminal.enabled: false`; agent shell remains available                            |
| Suppress Codex/Anthropic external session catalogs                                     | Existing plugin configuration   | Implemented: both `sessionCatalog.enabled: false`                                                        |
| Disable the general catalog-backed CLI-agent picker                                    | Existing configuration          | Not done: `gateway.cliAgents.enabled: false` is still absent                                             |
| Disable native marketplace discovery and operations                                    | Source patch + configuration    | Patch implemented and locally tested; `marketplace.enabled: false` is **not yet selected** in the preset |
| Correct configured-node browser guidance                                               | Source patch                    | Implemented and source-tested; actual model-selected deployment browsing remains unqualified             |
| Reconstruct patched source and build it in release CI                                  | Build tooling                   | Implemented and locally tested; patched image candidate has **not run through remote CI**                |
| Retained administrator forms, optional GitHub integration, remaining UI/setup curation | Source patches + preset choices | Not implemented                                                                                          |
| Physically exclude unwanted bundled plugins/skills                                     | Packaging                       | Not implemented; proposed selection below is unqualified                                                 |
| Document-analysis dependencies per recipe                                              | Recipe/package selection        | Not selected or qualified                                                                                |

The [preset](configuration.ts), [marketplace intent](openclaw/patches/optional-marketplace.prompt.md)
and [browser intent](openclaw/patches/browser-routing-guidance.prompt.md) own the
exact implemented behavior. A reconstructed OpenClaw build, browser regressions,
disabled-marketplace Gateway smoke, and ClawScarf checks/build passed locally.
The patch workflow and CI changes are still unpushed; published alpha.3 predates
both patches. No fully curated runtime has been built or published.

## Configuration limits

The first three implemented settings above need no source patch. The missing
CLI-agent setting also exists upstream; it defaults to enabled. The marketplace
setting is different: our patch introduces it, with upstream behavior enabled by
default. Selecting false and packaging unwanted files are still separate actions.

Presets apply once and remain editable native configuration. Refresh does not
reapply them. Existing installations need an explicit selected configuration
change; do not silently overwrite administrators' unrelated edits.

| Control                                            | What it actually does                                                                                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills.entries.<name>.enabled: false`             | Makes that skill ineligible; leaves its files installed                                                                                                                      |
| `skills.allowBundled`                              | A nonempty list restricts bundled/Custodian skill eligibility. **Omitted or `[]` means unrestricted**, not zero skills. It does not cover every plugin/workspace/user skill  |
| `plugins.entries`, `plugins.allow`, `plugins.deny` | Control activation, not package contents or catalog visibility. Empty allowlists are unrestricted; selected slots and explicitly enabled bundled channels have special rules |
| `security.installPolicy`                           | Native install approval policy; not a marketplace-off switch and may run after a catalog fetch                                                                               |
| `gateway.controlUi.root`                           | Serves a separately built native UI; does not disable backends or avoid maintaining UI patches                                                                               |

Missing executables or credentials are not curation: installing a CLI can make a
previously ineligible skill usable. See native [skill eligibility](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/skills/loading/config.ts)
and [plugin activation](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/plugins/config-state.ts).

## Product selection requiring patches

The following is the target, **not completed UI work**. The existing marketplace
patch covers native discovery/promotion and catalog operations only; its
[intent](openclaw/patches/optional-marketplace.prompt.md) lists the exact limits.
No general upstream configuration allowlist covers this whole product surface.

| Surface                                                                  | Target                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat, sessions, search, uploads, files, artifacts, agent/model selection | Keep native behavior and contextual actions                                                                                                                                                     |
| Agent creation/editing; Ask OpenClaw / Custodian                         | Keep agent management; add a native creation form before removing or narrowing the general setup assistant                                                                                      |
| Plugins, Skills, Skill Workshop                                          | Remove marketplace discovery; keep installed-extension administration, explicit-source installation and deliberate custom skill authoring                                                       |
| MCP, People, Connections                                                 | Keep scoped MCP configuration and People; Connections stays optional, with no page/tools/credentials/calls when absent                                                                          |
| Profile, Appearance, Notifications                                       | Keep identity and relevant preferences; remove GitHub linking/coauthor controls, direct-provider onboarding, CLI-session controls and unrelated promotion                                       |
| GitHub integration                                                       | Gate core account/session/tool integration, authenticated previews, credential injection, profile synchronization and OAuth background work; preserve ordinary links and deliberate Git CLI use |
| Models and account setup                                                 | Keep managed LiteLLM model selection; omit independent provider onboarding and personal direct-provider accounts                                                                                |
| Channels, Communications, Talk                                           | No messaging channels by default; expose only deliberately supported recipe capabilities and their required settings                                                                            |
| Device, Device permissions, Devices / Pair device                        | Omit personal-client onboarding/settings; preserve required browser-node enrollment                                                                                                             |
| Connection, Cloud workers                                                | Omit ordinary users' Gateway URL/token switching and unrelated host/cloud provisioning                                                                                                          |
| Memory, automation/cron/tasks                                            | Keep selected memory/workflows/scheduling; review engines, import, hooks, commands and bindings instead of exposing every schema field                                                          |
| Security, Secrets, Approvals, Infrastructure                             | Keep needed approvals and intentional administrator controls for retained services, browser/node and credentials                                                                                |
| Labs, Advanced/raw config                                                | Remove experimentation and catch-all UI; keep underlying custom-plugin support required by People/Connections                                                                                   |
| Debug, Logs, Usage, About                                                | Keep authorized diagnostics, usage, version/provenance/licenses; remove unrelated community/promotional links                                                                                   |
| Updates                                                                  | Remove competing upstream self-update UI and gate backend update operations; runtime versions belong to ClawScarf releases                                                                      |
| Apps, Lobsterdex                                                         | Remove unrelated app/browser-extension/download promotion and the cosmetic collection; Lobsterdex is separate from required Lobster workflows                                                   |
| Dashboards, Systems, Activity, Meetings, Portals, Worktrees              | Omit from the base unless a retained capability concretely needs them                                                                                                                           |

The [routes](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/ui/src/app-routes.ts),
[navigation](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/ui/src/app-navigation.ts)
and [settings ownership](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/ui/src/pages/config/config-sections.ts)
are the starting points. Cover direct routes, search, command palette, contextual
links and setup prompts as well as navigation. Unassigned sections must not
silently reappear in Advanced when upstream adds features.

**GitHub is not one plugin.** Removing the GitHub skill or Copilot provider leaves
core [tool](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/tools-github.ts),
[user](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/users-github.ts)
and [session](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/sessions-github.ts)
handlers, [previews](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/control-ui-github-preview.ts)
and the [OAuth lifecycle](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/github-oauth-lifecycle.ts).
A configurable core feature versus extraction into a plugin remains a design choice.

**Pairing is not teammate enrollment.** The device-pair plugin, core setup RPCs and
[join HTTP handler](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/device-pairing-join-http.ts)
are separate entry points. Preserve the bootstrap-token and pairing operations
used by [browser enrollment](../deploy/execution/browser-node/operator.ts), and
review each retained flow's scopes. Messaging channels are alternative inbound
conversation paths, not merely agent connectors: sender identity/admission must
be qualified before enabling one. Connections grants do not establish that model.

Each unavailable feature needs one native backend availability decision, exposed
to the UI. Cover RPC/HTTP, CLI/tools, startup/background services and outbound
requests; reject before network or persistent effects. State restart requirements
when live reconfiguration is unsupported. Keep shared configuration APIs needed
for retained administration; do not add an ingress RPC filter.

## Retained administrator paths

Provide these before removing their existing entry points or supporting skills:

| Task                       | Required path                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Create/edit agents         | Small form using native `agents.create`, then the existing editor, workspace and tool/skill controls; no new agent database |
| Configure MCP              | Native scoped stdio/remote definitions, enablement, credentials/OAuth and tool controls                                     |
| Add custom skills          | Native authoring/upload or workspace files, with agent assignment and eligibility feedback                                  |
| Install plugins            | Explicit pinned npm package/version form using native `plugins.install`; no discovery or catalog fallback                   |
| Manage installed plugins   | Installed-only inspect, enable/disable, reload, update and uninstall; retain selected plugin settings                       |
| Use local artifacts        | Native CLI inside the protected runtime; do not bypass the local-client requirement for web administrators                  |
| Manage membership/accounts | Existing People and optional Connections pages                                                                              |

The [native install handler](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/plugins-mutations.ts)
already supports explicit sources. The npm and agent-creation forms above are
**still proposed**. Browser archive upload is not promised; it needs its own
reviewed contract. A ClawScarf registry is not a prerequisite.

Preserve native authorization, source trust, capability consent, install policy,
integrity and transactional publication. Updates retain explicit source/version
choices; avoid update-all catalog fetches. Built-ins change through runtime
releases; administrators manage their additions. Reject ambiguous plugin-ID
collisions, and preserve additions/unrelated settings across restart and explicit
recipe reapplication. Inventory checks must not delete user-installed packages.

Package dependencies and MCP transports remain subject to outer network policy.
Report blocked destinations; do not open general egress or grant controller
access. Verify real dependency downloads, not just form submission. Operator-supplied
local artifacts remain available when remote installation is unavailable.

## Package and recipe selection

This is an **unqualified candidate**, not the current image inventory:

| Group                                       | Initial candidate                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Native team administration                  | `clawscarf-access`                                                                                   |
| Workflows                                   | Separately pinned official `lobster` artifact and embedded runtime                                   |
| Browser                                     | `browser` and required node-host registration; keep browser-node enrollment                          |
| Memory                                      | `memory-core`, qualifying the selected slot without direct-provider secrets                          |
| Model transport/execution                   | Initially `openai` and `codex`; determine what managed Responses/Completions routes actually require |
| Optional Connections                        | `clawscarf-connections` where that capability is supplied; disabled behavior must remain complete    |
| Ordinary bundled/Custodian skills           | Zero entries; physically omit them, not `allowBundled: []`                                           |
| Plugin-owned skills, bundles and packs      | Only explicitly selected files required by the chosen capability                                     |
| Messaging channels, other providers/plugins | None until deliberately selected for a recipe or installed by an administrator                       |

`OPENCLAW_EXTENSIONS=codex` currently retains that optional extension **alongside
upstream's default packaged set**. It does not mean only Codex is installed.
A catalog listing likewise does not prove an executable is installed or active.
Channels can be implemented as plugins. The [upstream package manifest](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/package.json)
already excludes some extensions, including WhatsApp/Signal; inspect the actual
image rather than treating page labels as inventory.

Produce a machine-readable selection of plugin IDs, skill paths, versions,
integrities and origins across upstream output, downloaded artifacts, ClawScarf
plugins and packs. Resolve required shared dependencies without admitting extra
plugins. Use the [upstream pruning mechanism](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/scripts/prune-docker-plugin-dist.mjs)
where suitable. Exclude unwanted files before final distributed layers are built;
a later-layer deletion leaves the bytes in inherited layers.

The assembled inventory must match: extra/missing entries and duplicate IDs fail.
Do not restore all upstream defaults to fix imports or fetch missing built-ins
on first use. Retaining Codex does not authorize its independent `codex_plugins`
marketplace; the session-picker setting and native marketplace patch do not cover
all harness surfaces. Upstream package, route and feature additions need explicit
selection during upgrades, not automatic exposure.

Start with one team runtime. [Recipes](../recipes/README.md) select a pinned runtime
and defaults; [packs](../packs/README.md) supply native files. Multiple recipes can
share an image. Select document/PDF executables and libraries for an actual
workflow; create an image variant only when those dependencies justify it.
A skill does not install its CLI, and `clawpdf` was an example, not a selected tool.
Keep Gateway/local tools/shell/Lobster on the shared team filesystem. The browser
controller remains separate. See [image evidence](../deploy/images/README.md#verified-limits).

## Verification and maintenance

Acceptance must establish absence **and** preservation against the exact images:

- Disabled features disappear from navigation, direct routes, search, palette and
  prompts, and reject direct RPC/HTTP/CLI/tool attempts before side effects. Check
  cold startup, background services, cached paths and zero unwanted catalog traffic.
- An injected unexpected built-in fails inventory checks. Retained workflows work
  without silent package restoration or new provider credentials.
- Chat/upload analysis, shared shell/Lobster files, approval/resume, agents/models,
  MCP, People/revocation and optional Connections still work. Cover member/admin,
  desktop/mobile and enabled/disabled feature states.
- A supplied plugin completes install, enable, invoke, restart, explicit update and
  removal; MCP completes add/authenticate/invoke/remove. Unauthorized mutations
  fail, and user additions survive restart and recipe reapplication.
- Browser enrollment survives curation. Actual model-selected browsing/file
  transfer has its separate [qualification task](../TODO.md#browser-qualification).

[README.md](../README.md) owns the team security boundary: code in the runtime
has Gateway authority, and native roles/UI controls are not isolation from that
code. Curation preserves external entry/revocation and outer protection.
Retain required licenses and upstream attribution when removing promotion.

[Patch maintenance](openclaw/README.md) owns editing, ordering, intent documents
and upstream upgrades. [Release CI](../release/README.md#build-and-publish) applies
saved patches to the exact pin, verifies the tree, builds both architectures and
packages provenance. Prompts are maintenance instructions, not build-time code
generation. Upstream submission is optional and currently not requested. There is
no automatic upstream update/repair, and clean patch application alone does not
qualify new upstream behavior. The patches affect the Gateway source image;
the browser controller retains its separately pinned published image.
