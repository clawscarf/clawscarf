# OpenClaw curation

**Source review baseline:** the findings below describe the
[reviewed working-branch implementation](https://github.com/clawscarf/clawscarf/tree/30dbebc13d39e46b99c3fc06b4d69af93edaca80)
on `codex/team-runtime-boundary`, including its unified team runtime and recipe
changes, now integrated for release preparation. References to reviewed behavior
below refer to that revision; source links pin it explicitly. The current
downstream implementation is distinguished from that baseline below.

This document owns the source findings and implementation design for reducing
OpenClaw's built-in product surface in ClawScarf. Proposed behavior is explicitly
separated from the reviewed implementation; this is not a second task list. The [product README](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/README.md) owns current
boundaries; [TODO.md](../TODO.md) owns unfinished work.

The review is against OpenClaw **2026.9.4**, revision
`7bc487d39dc9e059bb9b19ea08152883022f83fe`, selected by the
[component manifest](https://github.com/clawscarf/clawscarf/blob/30dbebc13d39e46b99c3fc06b4d69af93edaca80/release/components.json). Upstream links below point to
that revision. They do not describe every newer OpenClaw release. Recheck this
document when changing the pin, packaging or preset.

The evidence is source inspection of navigation, routes, settings, configuration,
packaging and relevant backend handlers. It is not a live inventory of every
installation, a screenshot review of every page, or acceptance of a curated image.

## Current implementation

The [maintained patch series](openclaw/README.md) contains two source changes:

- [Optional native marketplace](openclaw/patches/optional-marketplace.prompt.md)
  adds `marketplace.enabled: false` to suppress native marketplace discovery and
  promotion and reject catalog-backed operations at their backend owners. The
  setting defaults to enabled; the ClawScarf preset has not yet selected false.
  This patch does not physically exclude bundled plugins or skills.
- [Browser routing guidance](openclaw/patches/browser-routing-guidance.prompt.md)
  corrects the browser tool's instructions for a configured browser node. It
  preserves routing and permissions and is separate from product curation.

Ordered patch files, paired intent documents and the expected source tree are
implemented release inputs. A freshly reconstructed OpenClaw checkout passed its
full source build, browser regressions and a disabled-marketplace Gateway smoke
test; ClawScarf checks and build also passed. The release CI integration is
implemented locally, but has not yet been pushed or exercised in a patched image
candidate. Published alpha.3 predates these patches. A real model-selected browser
turn through the patched deployment remains unqualified.

The broader UI dispositions, administrator forms and package selection below
remain proposed. Adding this patch workflow does not complete those changes or
change existing installations. [Release documentation](../release/README.md#build-and-publish)
owns the build and publication process; [TODO.md](../TODO.md) owns outstanding work.

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
runtime, roles, conversations or plugin loader. The candidate base and
qualification rules below make the initial selection explicit. Secondary capabilities remain outside that candidate unless a selected
recipe requires them. This documentation does not authorize runtime changes.

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

Plugins can be executable extensions providing model providers, tools, channels
and UI. OpenClaw also supports bundles of skills, MCP definitions and related
configuration; a package inventory must cover both kinds. A messaging channel is
a capability; its implementation can be a plugin. “Channels” and “Plugins” being separate pages does not mean they are
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

The RPC list is not the entire integration. The pinned
[Gateway sidecar setup](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-lifetime-sidecars.ts)
creates and starts the
[GitHub OAuth lifecycle](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/github-oauth-lifecycle.ts),
which runs periodic maintenance. The
[GitHub preview implementation](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/control-ui-github-preview.ts)
and its API client provide another integration path. Feature removal must include
background lifecycle startup, preview request entry points, credential injection
and profile synchronization, not only the settings page and RPC registration.
Plain GitHub links in chat should remain ordinary links; they need not trigger
GitHub-specific authenticated previews.

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

| Surface                                                          | Finding and proposed treatment                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat, sessions, files, artifacts and agent selection             | Retain the native experience and contextual actions                                                                                               |
| Agent creation and editing                                       | Retain for authorized users; preserve a usable creation path when changing setup assistance                                                       |
| Ask OpenClaw / Custodian                                         | General setup and administration assistance exposes more product choices than the curated base needs; remove or narrow it deliberately            |
| Profile                                                          | Keep identity and personal preferences; remove built-in GitHub linking/coauthor controls and direct-provider account onboarding from the base     |
| Appearance                                                       | Keep useful display preferences; remove unrelated CLI-session-source controls and decorative feature promotion                                    |
| Notifications                                                    | Keep relevant personal notification preferences                                                                                                   |
| Device / Device permissions                                      | Native-client-specific settings; omit from the ordinary team web experience unless that client is deliberately supported                          |
| Connection                                                       | Gateway URL/token switching is inappropriate for ordinary users entering one protected team installation                                          |
| Channels                                                         | No messaging integrations by default; include only deliberately selected channels with reviewed identity/admission behavior                       |
| Communications / Talk                                            | Retain only capabilities the product or selected recipe actually supports; do not expose unrelated provider setup                                 |
| Devices / Pair device                                            | Remove personal-device onboarding from the base UI while preserving required browser-node enrollment internals                                    |
| Cloud workers                                                    | Remove unrelated cloud-worker/host provisioning from the base                                                                                     |
| Agents settings                                                  | Retain native agent management with an intentional administrator surface                                                                          |
| Models and model setup                                           | Keep managed model selection; remove independent provider onboarding and personal direct-provider account setup from the base                     |
| Plugins hub / plugin settings                                    | Remove the marketplace hub; retain administrator management of installed extensions and explicit-source installation, using native lifecycle APIs |
| Skills / skill settings / Skill Workshop                         | Remove marketplace discovery; preserve deliberate custom skill and agent authoring where selected                                                 |
| MCP                                                              | Retain deliberate administrator configuration and required credential handling                                                                    |
| Memory / memory import                                           | Keep useful memory capability; do not inherit every engine/add-on promotion automatically                                                         |
| Automation / cron / tasks                                        | Preserve selected workflows and useful scheduling; review general commands/hooks/bindings rather than exposing every schema field                 |
| Security / Secrets / Approvals                                   | Preserve necessary approvals and administrator controls, including secrets needed by retained integrations                                        |
| Infrastructure                                                   | Gateway/browser/node/discovery/ACP configuration belongs to intentional administration, not the everyday chat surface                             |
| Labs                                                             | Remove feature experimentation UI; preserve custom-plugin support needed by People and Connections                                                |
| Advanced / raw configuration                                     | Remove the catch-all editor from the ordinary product surface; otherwise new upstream schema sections automatically reappear                      |
| Debug / Logs / Usage                                             | Keep appropriate diagnostics and usage views with native authorization                                                                            |
| Updates                                                          | Runtime image/version ownership belongs to ClawScarf releases; remove competing upstream self-update UX and review backend update entry points    |
| About                                                            | Keep version/provenance/license information; curate hardcoded upstream community and promotional links                                            |
| Apps                                                             | Remove unrelated app-store, browser-extension, release-download and marketplace promotion                                                         |
| Lobsterdex                                                       | Cosmetic collection feature; distinct from the required Lobster workflow engine and removable independently                                       |
| Dashboards / Systems / Activity / Meetings / Portals / Worktrees | Additional workspace surfaces, not all necessarily useless; omit from the base unless a concrete retained capability needs them                   |

Several dependencies make a blanket “hide settings” patch insufficient:

- **Agent creation:** the new-agent entry point routes to Custodian with
  `intent=new-agent`. Removing the assistant without providing a retained native
  creation flow would break an explicitly wanted capability. Native
  [`agents.create`](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/agents.ts)
  already exists: reuse it for a small creation form followed by the existing
  editor, rather than adding another agent store or management backend. See
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

The optional-marketplace patch implements the native switch described in
[Current implementation](#current-implementation). The following findings explain
the required scope. Distribution-wide removal still requires selecting the
disabled preset, curating supplied packages and addressing any independently
shipped harness marketplace; the native switch alone does not establish that result.

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

The retained administrator path uses native explicit-source installation, as
specified below. It does not require building a ClawScarf registry or package
manager first. Image selection owns supplied packages; OpenClaw continues to own
administrator-added packages and their lifecycle. Removing marketplace discovery
must not remove custom skills, MCP or native integrity and capability checks.

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

## Candidate base and package qualification

The initial candidate is deliberately small. This is the proposed input to a
build-and-runtime qualification, not a claim that this reduced set already boots
or supports every retained workflow. Do not ship it until the acceptance cases
below pass. Do not silently restore upstream's full default set to make them pass.

| Package group                                                  | Initial candidate                                                  | Qualification condition                                                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native team UI                                                 | `clawscarf-access`                                                 | People, native identities and roles, enrollment and revocation remain usable                                                                                                                        |
| Workflows                                                      | `lobster`                                                          | Preserve the separately pinned official artifact and its embedded runtime; approval/resume must work                                                                                                |
| Browser                                                        | `browser`                                                          | Preserve the native tool and required node-host registration; omitting the personal-device onboarding plugin must not break enrollment                                                              |
| Memory                                                         | `memory-core`                                                      | Preserve the current default memory slot and exercise the supported memory path without adding direct-provider credentials                                                                          |
| Model transport and execution                                  | Initially retain `openai` and `codex` for qualification            | Trace their actual use by the configured LiteLLM routes and agent harness; retain only required implementations, with external session catalogs, provider onboarding and marketplace tools disabled |
| Optional Connections                                           | `clawscarf-connections` in a runtime that supplies this capability | Disabled operation has no page, tools, calls or credential requirement; enabled operation keeps its native page and broker contract                                                                 |
| Ordinary bundled and Custodian skills                          | No entries in the initial base candidate                           | Physically omit these directories' skill entries; this does not mean setting `allowBundled: []`                                                                                                     |
| Plugin-owned skills, bundles and recipe packs                  | Explicit files required by the selected package or pack            | Inventory separately; keeping a plugin must not silently keep all of its skills or nested bundles                                                                                                   |
| Messaging channels, other providers and other optional plugins | None in the initial base candidate                                 | Add only through a deliberate recipe/package decision or explicit administrator installation                                                                                                        |

The `browser` and `memory-core` names are source-verified, not inferred from page
names: see the [browser manifest](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/extensions/browser/openclaw.plugin.json)
and [default slots](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/plugins/slots.ts).
The `openai` and `codex` entries are conservative candidates, not a finding that
both are required for every LiteLLM model. Qualify Responses and Completions
routes separately; model-provider branding is not sufficient evidence to delete
a transport implementation. Conversely, retaining a harness does not authorize
its catalog or plugin marketplace. The
[Codex manifest](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/extensions/codex/openclaw.plugin.json)
also declares a `codex_plugins` tool and native plugin settings; these need
coverage beyond the session-picker switch.

The packaging slice must produce an exact machine-readable selection of plugin
IDs, skill paths, versions/integrities and origins from every source: upstream
package output, separately downloaded artifacts, ClawScarf plugins and selected
packs. Include required shared libraries without implicitly admitting additional
plugin IDs. Resolve and record the full dependency closure before producing the
final image. Build failures from missing imports are evidence to inspect the
dependency, not permission to ship another feature without review.

Compare the assembled image inventory to that selection. Unexpected plugins,
skills, duplicate plugin IDs or missing selected entries fail qualification.
An absent selected dependency must fail visibly; do not fetch omitted packages
automatically at startup or on first use.
Upstream additions should remain unshipped until selected. At upgrade time,
changes to native routes, setup entry points and exposed feature metadata also
require explicit disposition; UI curation must not depend on noticing a new page
manually after release. This is a build/upgrade check, not a second runtime plugin
registry or a restriction on deliberately installed user packages.

Start with one curated team image and an explicitly declared optional Connections
capability. Additional document tools and skills belong to a separately selected
recipe requirement, with an image variant only when its executable dependencies
justify one. Do not add every eligible skill to the base merely because it runs.

## Retained administrator workflows

Remove the marketplace hub, not all administration. Preserve native authorization
on every mutation. The first curated UI should keep a small administrator area
using the existing native pages and APIs, without a replacement dashboard or role
database:

| Administrator task                      | Retained path                                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create and edit agents                  | A creation form calling native `agents.create`, followed by the existing agent editor, tool/skill controls and workspace files                            |
| Add an MCP server                       | Existing scoped MCP settings for explicit stdio/remote definitions, credentials/OAuth where supported, and enablement/tool controls                       |
| Add a custom skill                      | Native skill authoring/upload or workspace files, followed by native agent assignment and eligibility feedback                                            |
| Install a supplied plugin               | An explicit npm package-and-version form using native `plugins.install` with `source: "npm"`; no discovery, recommendations or official-catalog fallback  |
| Manage installed plugins                | An installed-only administrator view using native inspect, enable/disable, reload, update and uninstall; preserve configuration for retained plugin pages |
| Use a local plugin directory or archive | Installation operator runs the native CLI inside the protected runtime; preserve the local-client requirement rather than bypassing it for web requests   |
| Manage team membership and accounts     | Existing People and optional Connections pages, with their current external service boundaries                                                            |

The [native install schema](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/packages/gateway-protocol/src/schema/plugins.ts)
already distinguishes npm, local, npm-pack, Git, official, ClawHub and marketplace
sources. The [install handler](https://github.com/openclaw/openclaw/blob/7bc487d39dc9e059bb9b19ea08152883022f83fe/src/gateway/server-methods/plugins-mutations.ts)
requires a local Gateway client for local artifacts. A web administrator is not
automatically such a client. Browser-based local archive installation is not
promised in the first slice; it would need a separately reviewed upload contract.
The explicit npm form is a proposed UI change, not an existing upstream screen.

For the initial curated path, accept explicit pinned npm packages and native local
artifacts; preserve source trust confirmation, capability consent, install-policy,
integrity and transactional publication behavior. Disable implicit official
catalog resolution and marketplace fallback. Updates must retain the explicit
source and version choice; do not expose a generic refresh/update-all action that
contacts excluded catalogs. Built-in image packages are replaced through runtime
releases, while native lifecycle management operates on administrator-added
packages. Reject ambiguous ID collisions instead of silently shadowing a built-in.

Package fetches and MCP transports remain subject to the existing outer network
policy. The installation UI must report a blocked destination clearly; it must
not open general egress or put controller authority in the Gateway. Local artifacts
provide an operator path where remote installation is unavailable. A concrete
installation test must verify the approved source's dependency fetches, not merely
that its form submits. Preserve native protections when removing ClawHub audit
calls; do not turn off all install validation to suppress one remote service.

Verify install, enable, invoke, restart, update and removal of a small user plugin,
and add, authenticate where applicable, invoke and remove an MCP server. Confirm
member rejection for administrator-only mutations. Custom package state and
unrelated native edits must survive restart and explicit recipe reapplication;
image inventory checks must not delete these user additions.

## Feature boundaries and implementation order

A product feature needs one effective availability decision in its backend owner,
with availability exposed to the UI through the existing Gateway bootstrap or
capability mechanisms. Navigation, direct routes, settings search, command
palette, contextual actions, agent-visible tools and setup prompts must agree.
Do not implement UI-only flags and independently maintained backend deny lists.
Retain shared methods such as config access for supported administration; gate
excluded feature operations at the point where they would perform their effects.

For each feature patch, identify HTTP and RPC entry points, CLI and tool calls,
startup/background services, credentials and outbound requests. When disabled,
reject operations before network or persistent side effects and do not start its
background service. Cover live configuration changes if supported; otherwise
require a visible restart rather than claiming immediate disablement. An upstream
configurable patch may keep its upstream default while the ClawScarf preset turns
it off. Such a mutable setting is not physical removal or protection against a
trusted administrator changing configuration. The curated UI does not offer
switches for excluded product features.

Use these commit boundaries in dependency order. Intermediate builds are test
candidates; publish only the integrated, qualified runtime in the final row.
Install and agent-creation replacements must land before their existing entry
points or supporting skills are removed:

| Slice                           | Concrete result required before proceeding                                                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline and inventory          | Select/integrate the already reviewed team-runtime baseline separately; record the actual image inventory and candidate selection, dependency closure and native route inventory                            |
| Existing configuration          | Add the explicit CLI-agent switch; retain terminal/community suppression; verify picker, direct terminal access and required model routes without calling this package removal                              |
| Retained administration         | Add the native agent creation form, retain scoped MCP and installed-extension settings, and implement explicit-source installation with native authorization and source restrictions                        |
| Marketplace removal             | Gate ClawHub, official catalog fallback and other shipped marketplace entry points, including harness tools; verify the retained administrator installation path with marketplace availability disabled     |
| Optional GitHub integration     | Gate UI, RPC/HTTP previews, background OAuth lifecycle, credential injection and related setup; preserve ordinary links and deliberate Git CLI use                                                          |
| Remaining UI and setup curation | Apply the disposition table to navigation/routes/search; remove Custodian only after the replacement creation flow works; retain MCP, People, Connections, approvals and installed-extension administration |
| Curated package build           | Build the candidate base, physically omit unselected packages and skills, resolve dependencies explicitly, and exercise retained workflows against that exact image                                         |
| Qualified runtime release       | Record downstream source and image provenance, verify restart and retained administrator additions, then run the complete acceptance cases and documentation checks                                         |

The reviewed team-runtime and installer baseline is integrated for release
preparation. Curation remains separate work. Do not apply this design to the old
worker arrangement and claim it verifies the unified runtime. No backward-compatibility or legacy-worker migration is part of this
work. The product README and contributor rules now allow maintained source patches
while preserving native ownership of application state. The patch workflow does
not itself implement the remaining curation slices.

Marketplace tests must cover attempted catalog search/install/update and a
successful explicit-source installation with no unwanted marketplace requests.
GitHub tests must cover cold startup, direct RPC/HTTP attempts, ordinary pasted
links and retained chat after disablement. Package tests must detect an injected
unexpected built-in entry. UI tests should cover member and administrator access,
direct URLs, search and mobile layouts, including missing/disabled optional
Connections. Retained feature tests include upload-to-file analysis, shell and
Lobster acting on the same files, approval/resume, agent creation, model selection,
MCP tools, People/revocation and browser-node enrollment. The separately owned
browser-routing bug remains explicitly outside this curation slice; do not claim
that package selection fixes it.

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

The [patch workflow](openclaw/README.md) owns maintenance commands. Its canonical
inputs are the pinned upstream revision, ordered Git
mail patches, paired intent documents, and expected resulting source tree.
Development checkouts are reconstructed from those inputs; Git or optional StGit
edits their commits, then the exporter verifies exact replay before updating the
saved series. Do not independently maintain a divergent fork as another release
source. Upstream submission is optional and currently not requested.

The manually dispatched [release candidate CI](../release/README.md#build-and-publish)
fetches the pinned upstream commit, applies the saved patches in series order and
verifies the expected tree before building the Gateway image on each architecture.
An application failure or tree mismatch stops the build. Paired intent documents
guide future maintenance; CI does not execute prompts or regenerate patches.
The two architectures must agree on source provenance and the patch archive before
image indexes are published. Candidate assembly validates and packages that
evidence. Publication then uses the built candidate without rebuilding it.
There is no automatic upstream-pin update or agent-driven repair in this workflow.

Record the upstream base, reconstructed revision, source tree, patch-set digest
and final image digest. A version label such as 2026.9.4 alone does not identify
patched content. The source patches affect the Gateway image; the separate browser
controller retains its published upstream image pin. See
[Current implementation](#current-implementation) for tested and published status.

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

These remain full-curation acceptance criteria. The initial two source patches
do not establish that the complete proposed product surface or package selection
is implemented. The [runtime guide](README.md) distinguishes current configuration,
source patches and published behavior.
