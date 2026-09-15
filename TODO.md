# Remaining work

Work in this order, one selected slice at a time. This is a roadmap, not permission
to run the entire list automatically. Current configuration and limits are in
[README.md](README.md#installation-management-direction).

## Next implementation

- [ ] **1. Finish browser operator integration.** Wire the verified local public-SDK
      node-only enrollment into startup/stop; retain identity and native revocation.
      Correct upstream browser-tool guidance: a configured node is used when target
      is omitted, but the description still advertises `host`; disabling host control
      also blocks nodes. No prompt/RPC workaround or weaker OpenShell policy. Then
      verify ordinary member/admin browsing and retained browser profile state.

## Following slices

- [ ] **2. Unify installation configuration and CLI.** Evolve existing operators into
      one entry point and validated JSON schema: artifacts, resources/storage, URLs/TLS,
      access/bootstrap, execution/browser, models, Connections and packs/capabilities.
      Define required/optional fields, secret references, validation/preview and supported
      reconfiguration. Add coherent start/stop/status/logs/diagnostics; preserve existing
      login/upgrade operations, native edits, ownership and uncertain-effect handling.
      Use explicit development or released artifacts with the same implementation.
- [ ] **3. Complete administrator setup and ongoing People UX.** Initial setup must
      establish and verify the intended administrator without ad hoc component commands.
      Keep local evaluation and generic OIDC. Resolve the manual subject-ID enrollment
      experience without automatic IdP-wide admission; People owns ongoing enrollment/
      revocation, OpenClaw owns roles. Verify two-person login, handover and revocation.
- [ ] **4. Compose optional integrations through that interface.** Support models
      disabled/external/local LiteLLM and Connections disabled/external/local Composio;
      include scoped credential provisioning, activation, rotation and explicit changes.
      Verify an actual external-account/native-tool journey and no dead-end UI/tools when
      omitted. Wire explicit pack/capability selection through native lifecycle and
      prerequisites; no capability wishlist becomes mandatory. Do not split Connections
      into another process in this slice.
- [ ] **5. Qualify and publish one supported release.** Build current images/operator,
      verify exact artifacts on a fresh machine: login, model/tool use, browser, widgets,
      hooks, two-person access, restart and integrations disabled. Record platform/resource
      limits; complete licenses/source obligations and private vulnerability reporting.
      Publish verified downloads/checksums, not development tags. Current evidence is
      macOS arm64/Docker Desktop; Linux/WSL and cross-version upgrades remain unqualified.
- [ ] **6. Build the terminal installer last.** Discuss its opt-in choices first.
      Download/select artifacts, collect configuration, preview, install/resume and print
      the working URL through the same CLI; support unattended use and existing installs.
      No duplicate orchestration, secrets in argv, or silent source-build fallback.

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
