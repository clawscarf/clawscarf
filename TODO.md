# TODO

Open work only. Select a task before implementing; this list does not authorize continuation.

## Installer and releases

- [ ] Fix native pack removal when an attached automation requires Gateway authentication
      under trusted-proxy login; verify removal on a retained installation without bypassing ownership checks.
- [ ] Finish the release build: exact images/tools, pack operator Python prerequisites,
      a distributable connector catalog and platform archives with checksums/license notices.
      Keep recipes and packs together as defined in the [release guide](release/README.md).
- [ ] Download and verify the CLI's matching release bundle; retain it and the operator
      outside npm's temporary cache. Pin installations; never resolve latest during startup.
- [ ] Test a complete release on a clean supported machine through administrator login
      and a real model response, then publish the matching npm CLI, GitHub assets and GHCR images.

## Native application management — separate from installation

- [ ] Build People using OpenClaw's native plugin UI: copyable invitations (no SMTP),
      admission, native role assignment, administrator handover and explicit removal.
      Include authenticated CLI operations and two-person login/open-session revocation tests;
      ordinary OIDC login grants no admission, and removal must leave team files/automations intact.
- [ ] Build optional Connections using OpenClaw's native plugin UI and authenticated CLI:
      account linking, callbacks, reconnect/disconnect and agent grants. Verify real account OAuth
      and a tool call; disabled installations expose no Connections UI/tools. Keep enforcement
      in the external backend; do not add account linking to the installer.

## Upgrade decision

- [ ] Decide whether to retain the custom local replacement/upgrade feature or defer it.
      Its [upgrade implementation](scripts/local/upgrade.ts), state and Python helper total
      580 lines, with additional startup-gate code/tests. The gate exists for this workflow;
      removing it alone would break replacement. Retained-volume startup remains required.

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

## Bugs to investigate

- [ ] Investigate the intermittent POSIX [process-group cleanup test](tests/local/supervisor.test.ts)
      failure under the parallel suite; isolated tests pass.
      Preserve structured signal failure diagnostics before changing cleanup timing.

## Future decisions

- [ ] Refine the illustrative Team documents recipe and verify its actual workflow;
      choose packs/Connections explicitly rather than treating the example as a finished product.
- [ ] Select Lobster, Codex or other optional packs individually. Preserve vanilla ClawHub
      discovery unless a supported curation approach is explicitly selected.
- [ ] Decide independent Connections deployment/authentication/storage if needed;
      the current optional service shares the Access companion process and public ports.
- [ ] Make ClawScarf easier to embed into a hosting product: define and qualify generic external
      ingress and directory-backed storage for hosting products built on top.
- [ ] Qualify Linux/WSL, changed-upstream-version upgrades and external hosting
      adoption, including persistent mounts, UID mapping, external identity/model/broker
      ownership, source-bound authorization and revocation.
- [ ] Define backups/recovery and stronger cross-tool policy/auditing separately.
      Retained volumes are not backups. Website, billing and fleet work remain separate.
