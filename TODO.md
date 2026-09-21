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

The [distribution guide](runtime/openclaw/README.md) owns general principles and
patch maintenance. Requirements below are unimplemented or unqualified; establish
retained administration before removing its old entry points. These tasks do not
authorize release publication or upstream PRs.

- [ ] **Configuration:** Set `gateway.cliAgents.enabled: false` in the preset;
      verify picker suppression and retained managed model routes.
- [ ] **Documentation:** Expand [native configuration](runtime/README.md) into a
      complete map of configured settings, purpose and source owners. Distinguish
      initial defaults, installation-dependent settings, administrator edits and
      restart/reapplication behavior; link exact values rather than duplicating them.
- [ ] **Selection:** Inventory the installed image's plugins and skills by exact
      ID/path, origin, purpose, execution location and required binaries/services.
      Select a small useful team-runtime set; exclude personal-host/hardware-specific,
      migration/setup-only and otherwise unselected capabilities. Missing runtime
      binaries disqualify a shipped capability unless explicitly selected and packaged.
      Distinguish installed, enabled and ready; UI counts are not the selection contract.
- [ ] **UI naming:** Use consistent display names, `People` and `Connections`, in
      plugin manifests, registration, settings and navigation; preserve stable plugin
      IDs and Account functionality. Update affected tests and component documentation.
- [ ] **Patch:** Add a native `agents.create` form followed by the existing editor,
      workspace and tool/skill controls before removing or narrowing Custodian and
      its setup skills. Preserve native authorization; do not create a new agent store.
- [ ] **Patch:** Provide installed-only plugin inspect/enable/disable/reload/update/
      uninstall and an explicit pinned npm package/version form using native
      `plugins.install`, without discovery or catalog fallback. Retain selected plugin
      settings and the CLI local-artifact path; web users cannot bypass local-client checks.
- [ ] **Patch:** Preserve native source trust, capability consent, install policy,
      integrity and transactional publication in the curated install/update paths.
      Keep explicit source/version choices, reject ambiguous plugin-ID collisions and
      avoid update-all catalog fetches. Browser archive upload needs a separate contract.
- [ ] **Verification:** Preserve custom skill authoring/upload/workspace files,
      agent assignment and eligibility feedback, plus scoped stdio/remote MCP,
      enablement/tool controls and credentials/OAuth. Test actual dependency fetches
      and blocked destinations without widening egress; a new package registry is not required.
- [ ] **Patch completion:** Remove remaining ClawHub promotion/setup/publishing
      references and independent marketplaces in retained harnesses, including
      `codex_plugins`. Reuse the existing native patch; retain required attribution.
      For every curated feature, update shipped docs/help, tool descriptions, prompts
      and skill instructions alongside its removal; verify no unsupported setup advice.
- [ ] **Patch + configuration:** Make core GitHub integration optional and disable it
      in the base: settings/account linking, account/session/tool APIs, authenticated
      previews, credential injection, profile synchronization and background OAuth.
      Choose a core switch or plugin seam;
      preserve ordinary links and deliberate Git CLI use, without automatic authenticated previews.
- [ ] **Patch:** Remove Cloud Workers navigation, settings and provisioning/setup
      journeys; disable their RPC/HTTP/CLI/tool and background provisioning paths before
      effects. Preserve the OpenShell team runtime and required browser-node operations.
- [ ] **Patch:** Remove personal-device onboarding and native-client settings from the
      base, including plugin, core setup RPC and join-HTTP entry points. Preserve required
      browser-node bootstrap-token/pairing operations and review each retained flow's scopes.
- [ ] **Channels:** Review messaging channels for retention rather than removing them
      as a category. Select useful channels whose dependencies work in the team runtime;
      qualify sender identity, admission, native authority and revocation before enabling
      them. Retain Channels/Communications and setup for selected channels; assess Talk
      separately against available audio/runtime support. Connections grants are separate.
- [ ] **Patch:** Keep managed LiteLLM model selection while removing independent provider
      onboarding and personal direct-provider accounts from Profile, model setup and backends.
- [ ] **Patch:** Curate everyday UI: retain chat/sessions/search/uploads/files/artifacts,
      agent/model selection, identity and relevant appearance/notification preferences.
      Remove CLI-session controls, Gateway URL/token switching and unrelated About/Apps/
      community/download/browser-extension promotion; retain version, provenance and licenses.
- [ ] **Settings selection:** Define explicit admin/member pages and actions, including
      selected channels and optional capabilities. Remove irrelevant member inspection
      pages and the Advanced/raw-config catch-all; give every retained control a deliberate
      home. Cover direct routes/search/palette/contextual links and native authorization;
      newly introduced upstream sections must not appear automatically.
- [ ] **Patch:** Retain intentional administrator settings for agents, scoped MCP,
      People, optional Connections, selected memory/import and automation/cron/tasks,
      security/secrets/approvals, infrastructure and authorized debug/logs/usage. Review
      engines, hooks, commands and bindings; absent Connections must need no page/tools/calls/credentials.
- [ ] **Labs:** Remove the Labs page while preserving native custom plugin UI for
      Account/People, optional Connections and deliberate administrator additions.
      Retain the preset's custom-plugin capability and move any needed administration
      to Plugins; replace disabled-state links/instructions that currently point to Labs.
      Qualify plugin pages, assets, authorization and restart without visiting Labs.
- [ ] **Patch:** Remove cosmetic Lobsterdex and unselected Dashboards/Systems/Activity/
      Meetings/Portals/Worktrees. Preserve required Lobster workflows; cover direct
      routes/search/palette/contextual links and prompts.
- [ ] **Patch:** Remove competing upstream self-update UI and gate its backend operations;
      keep runtime version ownership in ClawScarf releases and native lifecycle for user additions.
- [ ] **Packaging:** Qualify the initial candidate: `clawscarf-access`, official `lobster`
      with its embedded runtime, `browser` plus node-host registration, `memory-core`,
      initially `openai`/`codex`, `document-extract` for retained native PDF extraction,
      selected channels, and optional `clawscarf-connections`. Trace managed Responses/
      Completions and document dependencies before removing transports; require no new
      direct-provider secrets. Remove unselected plugin files, not just enabled flags.
- [ ] **Skills:** Select shipped skills independently of plugins across bundled,
      Custodian, plugin-owned and pack sources. Remove unsupported OS/device workflows
      (for example Apple Notes, Things and home-device control), omitted-feature setup
      and skills requiring unshipped binaries. Keep generally useful skills only with
      exercised dependencies; preserve custom/local/workspace skills and authoring.
      A fresh install must not advertise unsupported skills as ready or needing setup.
- [ ] **Skill lifecycle:** Verify plugin disable/uninstall removes its contributed
      skills from effective discovery and prompts after the required refresh/restart;
      distinguish package removal from eligibility and independently stored copies.
      Cover generated skill links, session snapshots and retained user skills; document
      why uninstalling a plugin does not remove the separate bundled skill library.
- [ ] **Packaging:** Physically omit unselected skills/channels/providers/plugins
      before final distributed layers. Start with one team image and declared optional
      Connections; do not restore all upstream defaults to fix missing imports or fetch
      omitted built-ins on first use. Preserve selected plugin bundles and pack files.
- [ ] **Packaging:** Record exact plugin IDs, skill paths, versions/integrities, origins
      and dependency closure across upstream output, downloaded artifacts, native plugins
      and packs. Exclude files before final distributed layers; reject extra/missing/duplicate
      entries and new upstream routes/features. Preserve deliberate administrator additions.
- [ ] **Recipe + packaging:** Select and exercise document/PDF tools and skills on the
      shared team filesystem; create a runtime variant only if executable dependencies justify it.
      Preserve native `document-extract` and its bundled `clawpdf` dependency when selecting
      PDF extraction; additional document skills need their own verified executable dependencies.
- [ ] **Verification:** Qualify curated absence across UI, direct RPC/HTTP/CLI/tools,
      cached paths and cold-start/background services: disabled features reject before
      effects and produce no unwanted catalog traffic. Exercise enabled/disabled states,
      required restarts and injected unexpected inventory entries.
- [ ] **Verification:** Qualify retained chat/upload analysis, shared shell/Lobster files,
      approval/resume, agents/models, People/revocation and optional Connections on exact images.
      Cover member/admin, desktop/mobile and advertised skill paths after restart.
      Preserve browser enrollment; real browsing/file transfer remains in
      [Browser qualification](#browser-qualification).
- [ ] **Verification:** Exercise supplied-plugin install/enable/invoke/restart/explicit
      update/removal and MCP add/authenticate/invoke/remove, including unauthorized-mutation
      rejection and user additions/unrelated settings surviving restart and recipe reapplication.
      Verify artifact provenance and update publication status when released.

## Future decisions

- [ ] Make ClawScarf easier to embed into a hosting product: define and qualify generic external
      ingress and directory-backed storage for hosting products built on top.
- [ ] Qualify changed-upstream-version upgrades and external hosting adoption,
      including persistent mounts, UID mapping, external identity/model/broker
      ownership, source-bound authorization and revocation.
- [ ] Define backups/recovery and stronger cross-tool policy/auditing separately.
      Retained volumes are not backups.
