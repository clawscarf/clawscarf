# TODO

Open work only. Select a task before implementing; this list does not authorize continuation.

## Installer and releases

- [ ] Verify first-time production signup through email verification and installer resume.

- [ ] Finish the first [release candidate](.github/workflows/build-release.yml):
      enable public GHCR access, authenticate the initial npm publication and configure trusted
      publishing; verify a fresh installation through administrator login, real inference and stop/start.
      Then publish the same tested artifacts. macOS arm64 is the current supported target.
- [ ] Finish release distribution review: transitive licenses/source obligations,
      durable acquisition of pinned OS packages and a self-contained Python prerequisite
      for optional pack operations. The basic Team server recipe selects no packs.

## Upgrade decision

- [ ] Decide whether to retain the custom local replacement/upgrade feature or defer it.
      Its [upgrade implementation](scripts/deployment/upgrade.ts), state and Python helper total
      580 lines, with additional startup-gate code/tests. The gate exists for this workflow;
      removing it alone would break replacement. Retained-volume startup remains required.

## Owner-managed browser issue — DO NOT PICK UP AUTOMATICALLY

- [ ] **Owner will take this upstream as a separate task.** OpenClaw 2026.9.4
      routes an omitted browser target to the configured node, but its tool guidance
      advertises `host`; an explicit `host` selects the protected Gateway and fails
      public DNS preflight. This still applies with the single team runtime: the browser
      node remains separate and Gateway browser egress is not granted.
      Reproduce with `gateway.nodes.browser: { mode: "manual", node: "<paired node>" }`:
      compare omitted target, `target: "node"` and `target: "host"`. Expected: guidance
      matches effective routing, with explicit targets and sandbox policy preserved.
      Evidence, pinned sources and limits are in the [browser integration report](deploy/execution/browser-node/README.md#upstream-browser-routing-bug).
      Do not patch, report upstream, expand or resume this task automatically.
      Ordinary model-selected member/admin browsing awaits that supported correction.

## Future decisions

- [ ] Add a document-workflow recipe when selected; choose its packs and verify the
      workflow. The Team server recipe supplies the basic team server only.
- [ ] Curate the built-in plugin/channel/skill surface and remove ClawHub mentions.
      Keep user-added plugins/MCP possible; evaluate document dependencies per recipe.
      Native Lobster is required. Use the [curation findings](runtime/curation.md)
      for the candidate base, retained administrator paths and implementation order.
      Qualify the exact image inventory before removing packages; preserve native ownership.
- [ ] Package privately operated Connections against the same broker contract, independent of
      our hosted identity/billing services. The separation is part of the selected cloud design.
- [ ] Add payment integration to the cloud allowance policy when selected; keep connector
      usage separate from software licensing and any future AI-credit accounting.
- [ ] Make ClawScarf easier to embed into a hosting product: define and qualify generic external
      ingress and directory-backed storage for hosting products built on top.
- [ ] Qualify Linux/WSL, changed-upstream-version upgrades and external hosting
      adoption, including persistent mounts, UID mapping, external identity/model/broker
      ownership, source-bound authorization and revocation.
- [ ] Define backups/recovery and stronger cross-tool policy/auditing separately.
      Retained volumes are not backups. Website, billing and fleet work remain separate.
