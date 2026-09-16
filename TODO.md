# Remaining work

Work in this order, one selected slice at a time. This is a roadmap, not permission
to run the entire list automatically. Current configuration and limits are in
[README.md](README.md#installation-management-direction).

## Owner-managed browser issue — DO NOT PICK UP AUTOMATICALLY

- [ ] **Owner will take this upstream as a separate task.** OpenClaw 2026.9.4
      routes an omitted browser target to the configured node, but its tool guidance
      advertises `host`; an explicit `host` selects the protected Gateway and fails
      public DNS preflight. `allowHostControl: false` also blocks node browsing.
      Reproduce with `gateway.nodes.browser: { mode: "manual", node: "<paired node>" }`:
      compare omitted target, `target: "node"` and `target: "host"`. Expected: guidance
      matches effective routing, with explicit targets and sandbox policy preserved.
      Evidence, pinned sources and limits are in the [browser integration report](deploy/execution/browser-node/README.md#upstream-browser-routing-bug).
      Do not patch, report upstream, expand or resume this task automatically.
      Ordinary model-selected member/admin browsing awaits that supported correction.

## Selected implementation — verify each step before proceeding

- [ ] **2. Finish retained-install capability changes.** Initial models, Connections
      and pack selections are wired. Add reviewed capability change/reapply operations
      to the unified installation CLI: model routes/keys, broker settings/keys,
      enable/disable and pack selection changes. Reuse the existing component operators;
      preserve native edits, revoked credentials and uncertain outcomes. Current
      preparation rejects changed inputs rather than silently applying them.
- [ ] **3. First terminal installer.** Collect the supported settings, write private
      configuration and invoke the same CLI preview/apply/start implementation. Support
      explicit development releases first; published releases use the same schema.
      No protection switches, duplicate orchestration or silent build fallbacks.
- [ ] **4. Qualify and publish the supported release.** Build exact images and operator;
      generate the release file, verify it on a fresh installation, then publish downloads,
      checksums/notices to GitHub Releases and images to GHCR. Report qualified platforms
      and capability limits; the owner-managed browser issue is not an automatic task.
      Published artifacts must not claim unverified Linux/WSL or team journeys.

## Separate decisions and integrations

- [ ] Decide standalone OIDC first-administrator and ongoing enrollment UX before changing
      Access. Owner-claim, admission requests and invite links remain proposals. Current
      explicit subject/email bootstrap remains; qualify two-person login and revocation.
- [ ] Define and qualify generic external ingress and directory-backed storage for hosting
      consumers. Consumer implementation belongs in its own repository.

## Future decisions

- [ ] Select Lobster, Codex and additional packs individually; preserve vanilla
      ClawHub discovery until curation is explicitly selected and supported upstream.
- [ ] Decide independent Connections deployment/authentication/storage if needed;
      the current optional service shares the Access companion process and public ports.
- [ ] Qualify Linux/WSL, changed-upstream-version upgrades and external hosting
      adoption, including persistent mounts, UID mapping, external identity/model/broker
      ownership, source-bound authorization and revocation.
- [ ] Define backups/recovery and stronger cross-tool policy/auditing separately.
      Retained volumes are not backups. Website, billing and fleet work remain separate.
