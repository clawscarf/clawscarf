# TODO

Open work only. Select a task before implementing; this list does not authorize continuation.
This list covers the open-source ClawScarf distribution. Cloud-service work belongs in its own repository.

## Installer and releases

- [ ] Configure the [CLI PostHog destination](release/README.md#cli-telemetry-destination)
      and verify event receipt in the selected project before enabling a release.

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
- [ ] **Patch + configuration:** Make core GitHub integration optional and disable it
      in the base: account/session/tool APIs, authenticated previews, credential injection,
      profile synchronization and background OAuth. Choose a core switch or plugin seam;
      preserve ordinary links and deliberate Git CLI use, without automatic authenticated previews.
- [ ] **Patch:** Remove personal-device onboarding and native-client settings from the
      base, including plugin, core setup RPC and join-HTTP entry points. Preserve required
      browser-node bootstrap-token/pairing operations and review each retained flow's scopes.
- [ ] **Packaging + configuration:** Include no messaging channels by default. Before
      admitting a recipe channel, qualify sender identity/admission; expose Communications/
      Talk and related setup only for supported capabilities. Connections grants are separate.
- [ ] **Patch:** Keep managed LiteLLM model selection while removing independent provider
      onboarding and personal direct-provider accounts from Profile, model setup and backends.
- [ ] **Patch:** Curate everyday UI: retain chat/sessions/search/uploads/files/artifacts,
      agent/model selection, identity and relevant appearance/notification preferences.
      Remove CLI-session controls, Gateway URL/token switching and unrelated About/Apps/
      community/download/browser-extension promotion; retain version, provenance and licenses.
- [ ] **Patch:** Retain intentional administrator settings for agents, scoped MCP,
      People, optional Connections, selected memory/import and automation/cron/tasks,
      security/secrets/approvals, infrastructure and authorized debug/logs/usage. Review
      engines, hooks, commands and bindings; absent Connections must need no page/tools/calls/credentials.
- [ ] **Patch:** Remove Labs, Advanced/raw-config catch-all, cloud-worker provisioning,
      cosmetic Lobsterdex and unselected Dashboards/Systems/Activity/Meetings/Portals/Worktrees.
      Preserve custom-plugin support for People/Connections and required Lobster workflows.
      Cover direct routes/search/palette/contextual links/prompts; no automatic catch-all for new sections.
- [ ] **Patch:** Remove competing upstream self-update UI and gate its backend operations;
      keep runtime version ownership in ClawScarf releases and native lifecycle for user additions.
- [ ] **Packaging:** Qualify the initial candidate: `clawscarf-access`, official `lobster`
      with its embedded runtime, `browser` plus node-host registration, `memory-core`,
      initially `openai`/`codex`, and optional `clawscarf-connections`. Trace managed
      Responses/Completions dependencies before removing transports; require no new provider secrets.
- [ ] **Packaging:** Physically omit ordinary bundled/Custodian skills and unselected
      channels/providers/plugins; keep only selected plugin-owned skills/bundles/pack files.
      Start with one team image and declared optional Connections; do not restore all upstream
      defaults to fix missing imports or fetch omitted built-ins on first use.
- [ ] **Packaging:** Record exact plugin IDs, skill paths, versions/integrities, origins
      and dependency closure across upstream output, downloaded artifacts, native plugins
      and packs. Exclude files before final distributed layers; reject extra/missing/duplicate
      entries and new upstream routes/features. Preserve deliberate administrator additions.
- [ ] **Recipe + packaging:** Select and exercise document/PDF tools and skills on the
      shared team filesystem; create a runtime variant only if executable dependencies justify it.
      A skill does not install its CLI; `clawpdf` was an example, not a selected dependency.
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
