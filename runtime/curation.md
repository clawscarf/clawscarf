# OpenClaw curation

**Implementation baseline:** this review describes the
[reviewed working-branch implementation](https://github.com/clawscarf/clawscarf/tree/30dbebc13d39e46b99c3fc06b4d69af93edaca80)
on `codex/team-runtime-boundary`, including its unified team runtime and recipe
changes. Those implementation commits have not been merged into `main` by this
documentation change. References to current ClawScarf behavior below mean that
reviewed implementation; ClawScarf source links pin it explicitly.

This document owns the source findings and design considerations for reducing
OpenClaw's built-in product surface in ClawScarf. It is not an implemented feature
contract or a second task list. The [product README](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/README.md) owns current
boundaries; [TODO.md](../TODO.md) owns unfinished work.

The review is against OpenClaw **2026.9.4**, revision
`7bc487d39dc9e059bb9b19ea08152883022f83fe`, selected by the
[component manifest](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/release/components.json). Upstream links below point to
that revision. They do not describe every newer OpenClaw release. Recheck this
document when changing the pin, packaging or preset.

The evidence is source inspection of navigation, routes, settings, configuration,
packaging and relevant backend handlers. It is not a live inventory of every
installation, a screenshot review of every page, or acceptance of a curated image.
No curation patches have been implemented by this review.

## Intended product

The selected direction is a curated team chat experience, retaining substantial
OpenClaw functionality. Removing the Plugins page or Settings navigation alone
does not meet that objective. Unwanted bundled capabilities should be absent from
the installation; unwanted marketplace discovery and setup should also disappear.
Administrators should still be able to deliberately add agents, skills, MCP
servers and supported extensions.

The proposed everyday surface is chat, sessions, search, uploads, files and
artifacts; agent and model selection; relevant tool approvals; browser use; and
personal preferences. Native Lobster workflows are required. People remains
mandatory for the standalone product, and Connections remains optional. Agent
configuration, MCP configuration, deliberate extension management and diagnostics
belong in the appropriate administrator experience.

This is a product selection, not a proposal to replace OpenClaw's chat, agent
runtime, roles, conversations or plugin loader. The exact retained package list
and disposition of secondary pages still require selection. Recommendations in
this document do not authorize implementing all of them.

The [existing trust boundary](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/README.md#what-it-contains) remains: Gateway,
plugins, shell and local tools share one externally protected team runtime.
Code execution is trusted with Gateway authority. UI restrictions and native
application permissions are not isolation from a teammate who can execute code.

## Four different meanings of removal

| Change                                          | What it establishes                                                | What it does not establish                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Hide a page, link or picker entry               | Users do not encounter that UI entry point                         | The route, backend method, CLI or package is absent                                                       |
| Disable a capability through configuration      | The affected implementation observes its enablement setting        | Its files are removed, all other entry points are disabled, or an administrator cannot change the setting |
| Exclude a package from the image                | That package and appropriately pruned dependencies are not shipped | Core implementations or catalog records referring to it disappear                                         |
| Remove or gate the feature in its backend owner | The selected operation is unavailable through that backend path    | Other paths, such as CLI execution or a different service, are automatically covered                      |

For marketplace removal, these layers have to agree. An empty or disabled
catalog with installation cards still visible is not the requested experience.
Conversely, removing an installation button does not remove installation APIs.
Many Control UI actions use authenticated Gateway WebSocket RPC, rather than
public REST endpoints. Visibility, authorization and implementation are separate
questions.

Enforce feature decisions in OpenClaw's owning implementation. Do not introduce
an ingress RPC filter as a substitute. Access continues to own authenticated
entry and revocation, while OpenClaw owns application authorization and execution.

## What regular configuration can do

The [ClawScarf preset](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/runtime/configuration.ts) is applied on initial configuration;
it is not an immutable product policy. Existing installations and administrators'
subsequent edits must not be confused with that preset.

| Setting                                                   | Pinned upstream behavior when omitted                | Current ClawScarf preset | Limit                                                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `gateway.controlUi.communityInvite`                       | Invitation enabled                                   | `false`                  | Removes the invitation, not every Discord, GitHub or community link in other pages                                                 |
| `gateway.terminal.enabled`                                | Operator terminal enabled, with native authorization | `false`                  | Disables the operator terminal; ordinary agent shell tools remain separate                                                         |
| `gateway.cliAgents.enabled`                               | CLI-agent UI capability enabled                      | Not set                  | Setting `false` suppresses catalog-backed CLI-agent UI; it does not uninstall their plugins or remove every related settings panel |
| `plugins.entries.codex.config.sessionCatalog.enabled`     | Plugin-specific behavior                             | `false`                  | Disables that plugin's external session catalog, not the plugin itself                                                             |
| `plugins.entries.anthropic.config.sessionCatalog.enabled` | Plugin-specific behavior                             | `false`                  | Same distinction; not a general product selection switch                                                                           |
| `skills.allowBundled`                                     | No bundled-skill restriction                         | Not set                  | Controls eligibility for selected skill sources, not physical packaging                                                            |
| `plugins.allow` / `plugins.deny`                          | No allowlist or denylist restriction                 | Not set                  | Controls plugin activation with native rules; not an image manifest                                                                |

The first three upstream defaults are visible in the
[Control UI bootstrap](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/control-ui.ts)
and [terminal enablement](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/terminal/enabled.ts).
In particular, this pin tests CLI-agent enablement with `!== false`; do not infer
its default from a different checkout or newer release.

The preset also disables remote model-catalog refresh and mDNS. It enables native
custom plugin pages for standalone navigation, explicitly enables Codex and
Lobster, and bundles Connections with base enablement off. Installation selection
can activate Connections. These are existing choices, not a comprehensive curated
distribution.

### Skill eligibility is not installation

A skill is primarily instructions and metadata. Its presence does not imply that
its required executable or credentials are available. The pinned
[skill eligibility implementation](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/skills/loading/config.ts)
applies these separate decisions:

- `skills.entries.<name>.enabled: false` excludes that skill.
- A **nonempty** `skills.allowBundled` restricts bundled skills to matching names
  or keys. `enabled: true` does not override that restriction.
- **An omitted list and `allowBundled: []` both mean unrestricted.** An empty
  list is not a way to select zero bundled skills.
- This allowlist covers sources named `openclaw-bundled` and
  `openclaw-custodian`. It is not a universal allowlist for user, workspace or
  plugin-provided skills.
- Eligibility also evaluates platform, binary, environment and configuration
  requirements, and unavailable skill-secret state. Enabling a skill does not
  manufacture its dependencies.

Therefore, removing unwanted skill directories during packaging gives a clearer
built-in selection than relying on missing executables. Installing a new CLI
later can otherwise make previously ineligible shipped skills eligible. Neither
eligibility nor an enablement flag proves that an external service is actually
authenticated and working.

The reviewed ordinary [bundled skill tree](https://github.com/openclaw/openclaw/tree/7bc487d39dc9e059bb9b19ea08152883022f83fe/skills)
contains 51 skills. The earlier source/dependency assessment identified these
15 as eligible candidates in the reviewed Linux image environment:
`clawhub`, `control-ui`, `diagram-maker`, `healthcheck`, `meme-maker`,
`node-connect`, `node-inspect-debugger`, `notion`, `python-debugpy`,
`skill-creator`, `spike`, `taskflow`, `taskflow-inbox-triage`, `visualize`, and
`weather`. This is not a live installation inventory or a promise that each
service works. For example, Notion passing a CLI requirement does not establish
Notion authentication.

The remaining ordinary bundled names are `1password`, `apple-notes`,
`apple-reminders`, `bear-notes`, `blogwatcher`, `blucli`, `camsnap`,
`coding-agent`, `eightctl`, `gemini`, `gh-issues`, `gifgrep`, `github`, `gog`,
`goplaces`, `himalaya`, `mcporter`, `model-usage`, `nano-pdf`, `obsidian`,
`openhue`, `openai-whisper`, `openai-whisper-api`, `oracle`, `ordercli`,
`peekaboo`, `sag`, `sherpa-onnx-tts`, `songsee`, `sonoscli`, `spotify-player`,
`summarize`, `things-mac`, `tmux`, `trello`, and `xurl`. Platform, dependency,
credential and configuration requirements differ; this is not a recommendation
to retain or remove every item in either group.

Custodian also has special setup skills, including adding model providers,
configuring channels, cloud-image baking and diagnosing the Gateway. They are
separate from the ordinary skill list and require their own review if retaining
the setup assistant. Plugin-provided skills need separate inventory too.

### Plugins and channels

Plugins are executable extensions. They can provide model providers, tools,
channels and UI. A messaging channel is a capability; its implementation can be a
plugin. “Channels” and “Plugins” being separate pages does not mean they are
unrelated packaging systems.

Plugin activation is not universally default-off. Manifests, explicit settings,
configured channels and selected slots participate in activation. An omitted or
empty `plugins.allow` is unrestricted. Explicit bundled-channel configuration and
selected memory/context-engine slots have special activation rules; treating a
nonempty allowlist as an absolute package boundary is incorrect. Explicit deny
and disable decisions must also be considered. See the pinned
[activation implementation](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/plugins/config-state.ts).

The current image build selects `OPENCLAW_EXTENSIONS=codex`. **This does not mean
“the image contains only the Codex plugin.”** It retains a selected optional
extension alongside upstream's default packaged set. The upstream
[package manifest](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/package.json)
already excludes many extensions, including WhatsApp and Signal, while other
extensions remain packaged. A catalog listing is not proof that its executable
package is installed or its channel active.

Upstream's [Docker pruning script](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/scripts/prune-docker-plugin-dist.mjs)
removes omitted optional plugin files and unshared dependencies. It is a useful
packaging mechanism, not yet our complete selection contract. The upstream
[Dockerfile](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/Dockerfile)
also copies the ordinary skills directory. ClawScarf's
[image assembly](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/deploy/images/Dockerfile) adds its own native plugins and
separately packaged Lobster. A curated inventory must include all these sources.

Exclude unwanted files before assembling the final distributed image layers.
Deleting files in a later layer hides them from the resulting filesystem but
does not remove their bytes from the inherited image layers.

## Optional features that are actually core

OpenClaw's [vision](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/VISION.md#plugins--memory)
favors optional functionality in plugins and expanding the plugin API as core
gets smaller. That direction does not establish that every optional feature has
already been extracted.

GitHub illustrates the distinction:

| Functionality                                        | Owner at the pinned revision                                                                                                                                    | Effect of excluding it                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| GitHub Copilot model access                          | [GitHub Copilot plugin](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/extensions/github-copilot/openclaw.plugin.json)      | Removes that model-provider integration                          |
| Instructions for working with GitHub using `gh`      | [GitHub skill](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/skills/github/SKILL.md)                                       | Removes those instructions; does not remove account settings     |
| Shared and agent GitHub identities and authorization | [Core `tools.github.*` handlers](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/tools-github.ts) | Requires a core feature change, not excluding the Copilot plugin |
| Personal GitHub linking and disconnection            | [Core `users.github.*` handlers](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/users-github.ts) | Same distinction                                                 |
| Session GitHub publishing                            | [Core session handlers](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/sessions-github.ts)       | Same distinction                                                 |

The [core handler registry](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/core-handlers.ts)
registers tool and session GitHub functionality. The
[user handler module](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/users.ts)
incorporates personal GitHub handlers. Profile renders GitHub connections;
agent tools have additional identity controls. These are not removed by deleting
the GitHub skill or Copilot plugin.

An upstream proposal could extract optional GitHub account integration, including
its UI and backend, into a plugin. That may require extending plugin interfaces.
A smaller configurable core feature is another possible patch. Neither has been
implemented or established as the cheaper maintained solution yet. Retaining
ordinary `git`/`gh` use for selected agents is a separate packaging decision.

## Control UI and settings review

The reviewed surface includes the [route registry](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/ui/src/app-routes.ts),
[sidebar and settings navigation](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/ui/src/app-navigation.ts),
[configuration section ownership](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/ui/src/pages/config/config-sections.ts),
Profile, agent panels, the command palette and related backend owners. The
settings navigation declares 29 destinations; native device pages are conditional.
Hiding a sidebar destination does not remove its direct route or search entries.

The following is a proposed disposition, not a claim that these changes exist:

| Surface                                                          | Finding and proposed treatment                                                                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat, sessions, files, artifacts and agent selection             | Retain the native experience and contextual actions                                                                                            |
| Agent creation and editing                                       | Retain for authorized users; preserve a usable creation path when changing setup assistance                                                    |
| Ask OpenClaw / Custodian                                         | General setup and administration assistance exposes more product choices than the curated base needs; remove or narrow it deliberately         |
| Profile                                                          | Keep identity and personal preferences; remove built-in GitHub linking/coauthor controls and direct-provider account onboarding from the base  |
| Appearance                                                       | Keep useful display preferences; remove unrelated CLI-session-source controls and decorative feature promotion                                 |
| Notifications                                                    | Keep relevant personal notification preferences                                                                                                |
| Device / Device permissions                                      | Native-client-specific settings; omit from the ordinary team web experience unless that client is deliberately supported                       |
| Connection                                                       | Gateway URL/token switching is inappropriate for ordinary users entering one protected team installation                                       |
| Channels                                                         | No messaging integrations by default; include only deliberately selected channels with reviewed identity/admission behavior                    |
| Communications / Talk                                            | Retain only capabilities the product or selected recipe actually supports; do not expose unrelated provider setup                              |
| Devices / Pair device                                            | Remove personal-device onboarding from the base UI while preserving required browser-node enrollment internals                                 |
| Cloud workers                                                    | Remove unrelated cloud-worker/host provisioning from the base                                                                                  |
| Agents settings                                                  | Retain native agent management with an intentional administrator surface                                                                       |
| Models and model setup                                           | Keep managed model selection; remove independent provider onboarding and personal direct-provider account setup from the base                  |
| Plugins hub / plugin settings                                    | Remove upstream marketplace/discovery/install experience; retain native loading and configuration for packages intentionally supplied          |
| Skills / skill settings / Skill Workshop                         | Remove marketplace discovery; preserve deliberate custom skill and agent authoring where selected                                              |
| MCP                                                              | Retain deliberate administrator configuration and required credential handling                                                                 |
| Memory / memory import                                           | Keep useful memory capability; do not inherit every engine/add-on promotion automatically                                                      |
| Automation / cron / tasks                                        | Preserve selected workflows and useful scheduling; review general commands/hooks/bindings rather than exposing every schema field              |
| Security / Secrets / Approvals                                   | Preserve necessary approvals and administrator controls, including secrets needed by retained integrations                                     |
| Infrastructure                                                   | Gateway/browser/node/discovery/ACP configuration belongs to intentional administration, not the everyday chat surface                          |
| Labs                                                             | Remove feature experimentation UI; preserve custom-plugin support needed by People and Connections                                             |
| Advanced / raw configuration                                     | Remove the catch-all editor from the ordinary product surface; otherwise new upstream schema sections automatically reappear                   |
| Debug / Logs / Usage                                             | Keep appropriate diagnostics and usage views with native authorization                                                                         |
| Updates                                                          | Runtime image/version ownership belongs to ClawScarf releases; remove competing upstream self-update UX and review backend update entry points |
| About                                                            | Keep version/provenance/license information; curate hardcoded upstream community and promotional links                                         |
| Apps                                                             | Remove unrelated app-store, browser-extension, release-download and marketplace promotion                                                      |
| Lobsterdex                                                       | Cosmetic collection feature; distinct from the required Lobster workflow engine and removable independently                                    |
| Dashboards / Systems / Activity / Meetings / Portals / Worktrees | Additional workspace surfaces, not all necessarily useless; omit from the base unless a concrete retained capability needs them                |

Several dependencies make a blanket “hide settings” patch insufficient:

- **Agent creation:** the new-agent entry point routes to Custodian with
  `intent=new-agent`. Removing the assistant without providing a retained native
  creation flow would break an explicitly wanted capability. See
  [agents home](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/ui/src/pages/agents-home/view.ts).
- **Profile:** GitHub connections and model-account controls are embedded in the
  [Profile page](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/ui/src/pages/profile/profile-page.ts),
  not just isolated sidebar pages. Core
  [personal model authorization](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/users-auth-connect.ts)
  also requires review.
- **Custom plugin UI:** `gateway.controlUi.experimental.customPlugins` supports
  ClawScarf's native People and Connections pages. Removing Labs must not disable
  that underlying capability.
- **Advanced:** unassigned configuration sections fall into Advanced, and raw
  configuration editing exposes the wider schema. A curated menu with a generic
  catch-all still acquires new upstream features automatically.
- **Command palette:** it independently exposes navigation and catalog search.
  Page selection must cover direct routes, settings search, command entries,
  contextual actions and setup/chat links. See the
  [palette](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/ui/src/components/command-palette.ts)
  and [catalog search](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/ui/src/components/command-palette-catalog-search.ts).

No general configuration allowlist for this complete native product surface was
established by the review. A maintained upstream capability mechanism would be
preferable to many unrelated hardcoded UI edits, but it is a proposed extension,
not an existing solution we can simply configure.

### Serving a separately built Control UI

`gateway.controlUi.root` selects the directory of built Control UI assets served
by the Gateway. It does **not** require reinventing chat or writing a replacement
settings application. One option is to build the matching upstream UI with a
small downstream patch set and point the Gateway to those assets. See the
[Control UI documentation](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/docs/web/control-ui.md).

This separates asset delivery from the Gateway package; it does not remove UI
maintenance or disable backend capabilities. The assets still need to match the
pinned Gateway's protocol and bootstrap expectations. It is a packaging option
for patched upstream UI, not a magic override for individual menu entries. Prefer
supported extension/configuration points where they cover the actual requirement.

## ClawHub and installation entry points

ClawHub removal spans more than its bundled skill or Plugins page. The review
identified catalog/search/detail UI, command-palette search, chat cards and
setup references, plus backend skill and plugin operations. For example,
[skill handlers](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/skills.ts)
include installation with `source: "clawhub"` and ClawHub update behavior;
[plugin handlers](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/plugins.ts)
include search, catalog browsing/details and catalog-backed skill reads.

A complete change must also trace CLI install/update paths, marketplace-backed
plugin mutations, prompts and outbound catalog/security-verdict lookups. The
existing installation-policy mechanism is not equivalent to a marketplace-off
switch: policy evaluation can occur after fetching/staging a candidate. See
[install policy](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/security/install-policy.ts).
Do not claim “no marketplace traffic” from a hidden button or rejected final
installation alone.

The desired alternative is deliberate administrator installation through
ClawScarf's selected packaging model, retaining upstream extension formats where
useful. It must not remove legitimate custom skills or MCP merely to eliminate
the marketplace. The packaging model itself has not yet been built.

## Device pairing and messaging channels

Pairing authorizes another client or execution node to connect to the Gateway.
It is not the same thing as enrolling a teammate through ClawScarf login. Several
pieces exist independently:

- The [device-pair plugin](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/extensions/device-pair/index.ts)
  supplies a pairing command and related behavior.
- Core [device setup handlers](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/device-pair-setup.ts)
  implement Gateway setup operations independently of that plugin.
- A [join HTTP handler](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/device-pairing-join-http.ts)
  serves short-code exchange at `/j/<code>`; actual reachability also depends on
  ingress. This is not an unrestricted generic execution API.
- ClawScarf's [browser enrollment](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/deploy/execution/browser-node/operator.ts)
  uses native `issueDeviceBootstrapToken` and `listDevicePairing` SDK operations.
  Removing all pairing internals would break this integration.

The proposed boundary is to remove unwanted personal-device onboarding and its
entry points, while retaining specifically needed node enrollment. The scopes
granted by each setup flow must be reviewed; “pair device” is not one uniform
permission. Removing a UI page or the plugin does not remove core setup methods.

Messaging channels let people converse with agents through services such as
WhatsApp, Signal or Telegram. They are alternative inbound conversation paths,
not merely connectors for an agent to read a service. Their sender identity,
pairing and allowlist rules are not automatically equivalent to ClawScarf's
website admission. A team recipe could deliberately support a channel, but that
requires establishing the access model rather than enabling it for discoverability.
This differs from optional Connections and its account/agent grants.

## Packaging, recipes and execution

Use the existing separation between [runtime releases](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/release/README.md),
[recipes](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/recipes/README.md) and [packs](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/packs/README.md). A recipe pins a
runtime and supplies editable defaults; a pack supplies native agent, skill and
workflow files. Several recipes can share one image. Distinct dependency needs
can justify additional runtime images, but each recipe does not inherently
require its own image or execution worker.

Document analysis is an example: a useful skill does not install its required
PDF or office-processing CLI merely by being present. Package the selected
executables/libraries in the runtime that executes them and verify the real
workflow. Do not infer a `clawpdf` dependency or its packaging status from a prior
example name. The exact document toolchain remains a recipe decision. Existing
[image capability evidence](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/deploy/images/README.md#verified-limits) and the
[runtime verification](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/README.md#current-verification-and-limits) own what has
actually been exercised.

Gateway, native local tools, shell and Lobster run together in the current team
runtime. A richer document image must preserve that filesystem model. The browser
service remains separate, with native enrollment and routing. Curation does not
resolve the separately tracked upstream browser-routing issue.

NemoClaw's outer-sandbox approach was relevant to the earlier execution-boundary
discussion. It does not establish that NemoClaw removes OpenClaw's marketplace,
GitHub settings or other product surfaces. This curation review has not qualified
NemoClaw as an implementation of those requirements.

## Maintaining downstream changes

Prefer existing configuration for supported behavior, packaging for unwanted
optional files, and focused source patches for core/UI features that lack the
needed switches. Blindly deleting arbitrary core files creates more dependency
breakage than a coherent feature change. Conversely, hiding an unwanted package
is weaker than omitting it. Choose the mechanism per feature.

Author patches against the exact selected upstream revision in a downstream
branch or fork. Keep changes independently understandable: for example,
marketplace availability, optional GitHub account integration, UI feature
selection, and package selection. Each needs its own behavior and regression
evidence. Upstream PRs can seek reusable configuration or plugin seams; ClawScarf
must not depend on their acceptance to reproduce its release.

A practical distribution model is one pinned upstream source plus a small,
ordered patch series and packaging inputs. A fork can be the authoring and PR
workspace. Pick one authoritative representation for released changes; do not
maintain both fork commits and hand-edited patch files independently. The exact
mechanism should be chosen after the first concrete patches show their size and
dependencies. Current releases do not yet implement this patch workflow.

This is the useful part of the Linux-distribution analogy: upstream sources,
downstream changes and packaging are explicit. Debian documents patch series in
its [packaging guide](https://www.debian.org/doc/manuals/debmake-doc/ch11.en.html);
Ubuntu describes retaining downstream differences through
[merges and syncs](https://ubuntu.com/project/docs/how-ubuntu-is-made/processes/merges-and-syncs/).
Red Hat's [backporting explanation](https://access.redhat.com/solutions/57665)
describes applying selected fixes to an older baseline. It does not make an
indefinitely old OpenClaw baseline cheap for a small team to support.

For upstream upgrades, carry still-needed patches to a candidate revision, drop
changes already incorporated upstream, resolve conflicts and review the resulting
behavior. A clean cherry-pick only establishes that the text applied; it does not
prove correctness or that new entry points remain curated. Selected urgent fixes
can be backported between deliberate version upgrades. Neither blindly following
main nor freezing forever removes maintenance work.

Acceptance should demonstrate both absence and preservation: the final image has
the selected packages, unavailable capabilities reject direct backend calls,
removed UI is absent from routes/search/contextual actions, and unwanted
marketplace traffic is not attempted. At the same time, chat, uploads, agent
creation, MCP, required Lobster workflows, People, optional Connections and
browser enrollment must still work. Include disabled and enabled configurations
when proposing upstream switches. Update provenance and licenses with packaged
changes; retain upstream attribution even when promotional links are removed.

These are criteria for future selected work, not checks already passed by this
documentation. The current implementation remains the vanilla pinned runtime
described in the [runtime guide](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/runtime/README.md).
