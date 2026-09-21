# TODO

Open work only. Select a task before implementing; this list does not authorize continuation.
This list covers the open-source ClawScarf distribution. Cloud-service work belongs in its own repository.

## Installer and releases

- [ ] Qualify clean-machine installation on supported hosts, hosted login and real
      inference on Linux ARM64/x86-64, and the full Windows/WSL2 journey.
- [ ] Qualify concurrent native UI requests and long-lived streams through the shipped
      gRPC service forwards and address the [controller connection limit](deploy/openshell/README.md#application-transport).
- [ ] Qualify hosted signup/email verification, recovery, logout and account switching,
      plus customer OIDC callbacks/TLS, on a fresh installation.
- [ ] Add Intel Mac support when compatible upstream OpenShell tools are available;
      the pinned release supplies no Intel Mac binaries.
- [ ] Finish release distribution review: transitive licenses/source obligations,
      durable acquisition of pinned OS packages and a self-contained Python prerequisite
      for optional pack operations.

## Upgrade decision

- [ ] Decide how installed servers should move to a new ClawScarf release while keeping
      their data and configuration. Review the existing [runtime replacement](deploy/deployment/README.md#runtime-upgrade)
      before deciding what to reuse or remove; it replaces only the OpenClaw runtime,
      not the other services. Ordinary stop/start must continue to preserve data.

## Browser qualification

- [ ] Add narrow native permission for member browser use without granting full
      administrator authority; preserve administrative node/profile controls.
- [ ] Fix download transfer between Chromium, browser controller and runtime while
      preserving network isolation and excluding team files/credentials from Chromium.
- [ ] Qualify member/admin browsing and upload/download round trips on macOS and Linux
      release images before enabling the recipe default. Preserve explicit target
      semantics and unavailable-node failure; see the [browser owner](deploy/execution/browser-node/README.md#verified-release-limits).
      Upstream submission requires the owner's request.

## OpenClaw curation

This scope selects the shipped packages and removes the named UI features below.
Keep existing native plugin management, custom skills and MCP. The
[distribution guide](runtime/openclaw/README.md) owns patch maintenance and the
[image guide](deploy/images/README.md) owns packaging. Broader redesigns are separate
[deferred decisions](#deferred-product-decisions). No release publication or upstream PRs
are authorized by this checklist.

- [ ] **Bug — member Home session:** Fix non-admin Home opening
      `agent:main:main` and reporting `Session "agent:main:main" was not found.`
      Resolve a stable session owned by the current native user per agent across
      initial landing, sidebar Home and the Home assistant panel; preserve member
      session permissions. Verify first login before any admin chat, an existing
      admin-owned main session, reload and account switching.

### Plugins

Retain these 22 plugins without automatically enabling optional capabilities:
`clawscarf-access`, `clawscarf-connections`, `openai`, `codex`, `litellm`, `browser`,
`file-transfer`, `document-extract`, `web-readability`, `oc-path`, `memory-core`,
`active-memory`, `memory-wiki`, `lobster`, `llm-task`, `workboard`, `policy`,
`telegram`, `a2a`, `reef`, `imap` and `webhooks`.
Retain the browser-node registration, Lobster's embedded runtime and native PDF
extraction's bundled `clawpdf`. Retaining model runtime support does not retain
personal-provider account onboarding.

Remove each of these plugins from the distributed image, not just its enabled flag:

- [ ] Remove `admin-http-rpc` — unused additional admin HTTP endpoint.
- [ ] Remove `alibaba` — separate video-provider integration.
- [ ] Remove `anthropic` — direct Anthropic accounts and Claude CLI; retain Claude models through LiteLLM.
- [ ] Remove `apple-fm` — Mac-only Apple Intelligence.
- [ ] Remove `azure-speech` — separate Azure speech setup.
- [ ] Remove `beam` — external coding-session mirroring.
- [ ] Remove `bonjour` — local-network Gateway discovery.
- [ ] Remove `canvas` — paired Mac panels; preserve browser widgets and custom plugin UI.
- [ ] Remove `clawrouter` — alternative model router.
- [ ] Remove `copilot-proxy` — separate Copilot model route.
- [ ] Remove `crabbox` — cloud-worker provisioning.
- [ ] Remove `cua-computer` — personal desktop-node control.
- [ ] Remove `deepgram` — separate transcription service.
- [ ] Remove `device-pair` — personal-device setup; preserve core browser-node pairing.
- [ ] Remove `elevenlabs` — separate speech service.
- [ ] Remove `fal` — separate image/music/video provider.
- [ ] Remove `geolocation` — client-IP location lookup.
- [ ] Remove `github-copilot` — personal GitHub Copilot provider.
- [ ] Remove `google` — direct Google accounts; retain Google models through LiteLLM.
- [ ] Remove `huggingface` — direct model-provider integration.
- [ ] Remove `linux-node` — desktop notifications, camera and location.
- [ ] Remove `lmstudio` — personal/local inference-server integration.
- [ ] Remove `logbook` — personal desktop screenshot capture.
- [ ] Remove `microsoft` — separate speech-provider integration.
- [ ] Remove `microsoft-foundry` — direct model-provider integration.
- [ ] Remove `migrate-claude` — migration from Claude installations.
- [ ] Remove `migrate-hermes` — migration from Hermes installations.
- [ ] Remove `minimax` — direct model/media-provider integration.
- [ ] Remove `nvidia` — direct model-provider integration; preserve NVIDIA OpenShell.
- [ ] Remove `ollama` — separate local/cloud model integration.
- [ ] Remove `onepassword` — separate 1Password installation and secrets broker.
- [ ] Remove `opencode-go` — direct model-provider integration.
- [ ] Remove `openrouter` — direct integration; retain OpenRouter models through LiteLLM.
- [ ] Remove `runway` — separate video service.
- [ ] Remove `senseaudio` — separate transcription service.
- [ ] Remove `session-share` — sharing between paired Gateways.
- [ ] Remove `sglang` — separate inference-server integration.
- [ ] Remove `talk-voice` — voice selection for the unselected Talk setup.
- [ ] Remove `together` — direct model/video-provider integration.
- [ ] Remove `tts-local-cli` — unshipped speech executable.
- [ ] Remove `vault` — separate HashiCorp Vault integration.
- [ ] Remove `vllm` — separate inference-server integration.
- [ ] Remove `xai` — direct model/media/search-provider integration.

### Skills

Retain `browser-automation`, `connections`, `wiki-maintainer`, `diagram-maker`,
`node-inspect-debugger`, `skill-creator`, `spike`, `taskflow`, `visualize` and `weather`.
Plugin-owned skills follow their owning capability; Connections remains optional.
Preserve administrator-authored and other user-installed/local/workspace skills.

Remove each of these standalone bundled skills independently of plugin removal:

- [ ] Remove `1password` — missing op executable.
- [ ] Remove `apple-notes` — Mac application and missing memo executable.
- [ ] Remove `apple-reminders` — Mac application and missing remindctl executable.
- [ ] Remove `bear-notes` — Mac application and missing grizzly executable.
- [ ] Remove `blogwatcher` — missing blogwatcher executable.
- [ ] Remove `blucli` — personal audio hardware and missing blu executable.
- [ ] Remove `camsnap` — camera workflow and missing camsnap executable.
- [ ] Remove `clawhub` — disabled marketplace.
- [ ] Remove `coding-agent` — separate coding-worker setup and unavailable CLI commands on PATH.
- [ ] Remove `control-ui` — upstream Gateway/dashboard/setup instructions outside the selected scope.
- [ ] Remove `eightctl` — Eight Sleep hardware.
- [ ] Remove `gemini` — missing Gemini CLI and separate model setup.
- [ ] Remove `gh-issues` — missing GitHub CLI.
- [ ] Remove `gifgrep` — missing gifgrep executable.
- [ ] Remove `github` — missing GitHub CLI; core GitHub removal is a separate task.
- [ ] Remove `gog` — missing Google Workspace CLI.
- [ ] Remove `goplaces` — missing executable and separate Google Places key.
- [ ] Remove `healthcheck` — host firewall/SSH administration outside the agent runtime's responsibility.
- [ ] Remove `himalaya` — missing email CLI.
- [ ] Remove `mcporter` — missing executable; preserve native MCP support.
- [ ] Remove `meme-maker` — novelty workflow with browser/service assumptions.
- [ ] Remove `model-usage` — missing CodexBar and external coding-session cost logs.
- [ ] Remove `nano-pdf` — missing nano-pdf executable; preserve native PDF extraction.
- [ ] Remove `node-connect` — personal-device/Gateway setup.
- [ ] Remove `notion` — separate account/token instructions; use optional Connections.
- [ ] Remove `obsidian` — missing Obsidian application/CLI.
- [ ] Remove `openai-whisper` — missing Whisper executable.
- [ ] Remove `openai-whisper-api` — requires a direct OpenAI key inside the runtime.
- [ ] Remove `openhue` — personal lighting hardware.
- [ ] Remove `oracle` — missing executable and separate model/browser setup.
- [ ] Remove `ordercli` — personal food-order service.
- [ ] Remove `peekaboo` — Mac desktop automation.
- [ ] Remove `python-debugpy` — unshipped debugpy for advertised remote debugging; preserve Python execution.
- [ ] Remove `sag` — missing executable and separate ElevenLabs setup.
- [ ] Remove `sherpa-onnx-tts` — missing speech runtime/models.
- [ ] Remove `songsee` — missing audio-analysis executable.
- [ ] Remove `sonoscli` — personal speaker hardware.
- [ ] Remove `spotify-player` — missing playback executables.
- [ ] Remove `summarize` — missing summarize executable; preserve ordinary summarization.
- [ ] Remove `taskflow-inbox-triage` — synthetic demonstration, not working inbox integration.
- [ ] Remove `things-mac` — Mac application.
- [ ] Remove `tmux` — unshipped executable.
- [ ] Remove `trello` — missing jq and separate account credentials.
- [ ] Remove `xurl` — missing X CLI and separate account setup.
- [ ] Remove the `canvas` skill with its owning Canvas plugin.
- [ ] Remove `obsidian-vault-maintainer` from `memory-wiki`; retain `wiki-maintainer`.
- [ ] Change `skill-creator` instructions to use installed `python3` instead of `python`;
      exercise its packaged validator.
- [ ] Fix `taskflow` example paths to use packaged files rather than assuming the
      Gateway runs from the source checkout; exercise approval and resume.

### UI and configuration

- [ ] Qualify CLI-agent picker suppression and retained managed model routes in a
      released image using the [native preset](runtime/README.md).
- [ ] Document all configured settings, their purpose and source owners in
      [native configuration](runtime/README.md). Distinguish initial defaults,
      installation choices, administrator edits and restart/reapplication behavior;
      link exact values instead of copying them.
- [ ] Remove Cloud Workers navigation, settings, setup and provisioning operations,
      including background activity. Preserve the OpenShell team runtime.
- [ ] Remove native GitHub account linking/settings, account/session/tool APIs,
      authenticated previews, credential injection, profile synchronization and
      background OAuth from the base. Preserve ordinary links and deliberate Git CLI use.
- [ ] Remove Labs while preserving custom plugin UI for Account/People, optional
      Connections and administrator additions. Replace “Open Labs” links and enablement
      instructions; put any needed plugin-UI administration in Plugins.
- [ ] Rename `ClawScarf People` to `People` consistently in manifests, registration,
      settings and navigation. Keep `Connections`, stable plugin IDs and Account functionality.
- [ ] Remove setup/settings entries and operations for the removed capabilities,
      including personal-device/native-client setup, Talk and direct-provider accounts
      in Profile/model setup. Preserve managed LiteLLM model selection, selected channel
      setup and required browser bootstrap-token/pairing operations.
- [ ] Remove Systems for both members and administrators, including direct navigation
      and contextual links. Preserve required browser-node management.
- [ ] Remove OpenClaw server Updates and disable upstream server self-update operations.
      ClawScarf releases own the runtime version; retain updates for administrator additions.
- [ ] Remove remaining marketplace entry points, especially `codex_plugins` in retained
      Codex, and ClawHub promotion/setup/publishing advice. Extend the existing marketplace
      patch while preserving required attribution and deliberate explicit-source installs.

### Completion checks

- [ ] Build the selected image with no removed files in distributed layers or automatic
      first-use restoration. Check exact plugin IDs, skill paths, dependency versions,
      integrity and origins across upstream output, downloads and packs; reject unexpected,
      missing or duplicate entries. Preserve licenses and administrator additions.
- [ ] Update shipped docs/help, tool descriptions, prompts and skill instructions with
      each removal. Check direct routes, search, command palette, RPC/HTTP/CLI/tools,
      cached paths and cold-start/background activity: removed operations cause no effects
      or unwanted catalog traffic. Verify enabled/disabled states and required restarts.
- [ ] Verify the retained chat, uploads/files/artifacts, model selection, shell, Lobster,
      memory, agents, People/revocation and optional Connections on the exact image for
      members/admins and desktop/mobile, including loading/error states and restart.
      Absent Connections must need no UI/tools/calls/credentials; enabled invalid setup
      must fail visibly. Browser transfer qualification remains [separate](#browser-qualification).
- [ ] Verify existing plugin install/enable/invoke/reload/update/uninstall, skill
      authoring/upload/assignment and scoped stdio/remote MCP authentication and removal.
      Preserve native authorization, source trust, consent, install policy, integrity
      and atomic update publication. Reject ambiguous plugin IDs and unauthorized changes;
      test dependency downloads without widening egress or adding a package registry.
- [ ] Verify plugin disable/removal drops contributed skills and generated links after
      refresh/restart, including existing sessions. Preserve independent bundled/local
      copies and user additions/settings through restart and explicit recipe reapplication.
      Explain that image-bundled plugins require packaging changes, not normal UI uninstall.
- [ ] Qualify sender identity, admission, native authority and revocation before enabling
      retained channels or incoming automation. Keep Connections account grants separate.

## Deferred product decisions

These are outside the agreed curation scope; decide separately before implementation.

- [ ] Decide whether to remove/narrow Custodian and its setup skills. If selected,
      first provide native agent creation with the existing editor/workspace/tool/skill
      controls; preserve authorization and the native agent store.
- [ ] Decide whether to replace Advanced/raw configuration with explicitly selected
      admin/member settings and prevent new upstream sections appearing automatically.
      Review engines, hooks, commands and bindings as part of that decision.
- [ ] Decide individually whether to retain Dashboards, Activity, Meetings, Portals,
      Worktrees and cosmetic Lobsterdex; preserve useful visualization and Workboard.
- [ ] Decide separately on Gateway URL/token switching and unrelated About/Apps,
      community/download/browser-extension promotion; retain version, provenance and licenses.
- [ ] Select additional document/PDF authoring tools and skills only as a separate
      enhancement; package and exercise their executables on the team filesystem.
      Create a runtime variant only if executable dependencies justify it.

## Future decisions

- [ ] Make ClawScarf easier to embed into a hosting product: define and qualify generic external
      ingress and directory-backed storage for hosting products built on top.
- [ ] Qualify changed-upstream-version upgrades and external hosting adoption,
      including persistent mounts, UID mapping, external identity/model/broker
      ownership, source-bound authorization and revocation.
- [ ] Define backups/recovery and stronger cross-tool policy/auditing separately.
      Retained volumes are not backups.
