# TODO

Open work only. Select a task before implementing; this list does not authorize continuation.

## Installer and releases

- [ ] Fix native pack removal under trusted-proxy login: monitor cleanup requires Gateway
      authentication even when the pack declares no monitors. Verify removal on the protected
      team runtime without bypassing ownership checks.
- [ ] Finish the release build: exact images/tools, pack operator Python prerequisites,
      platform archives with checksums/license notices.
      Keep recipes and packs together as defined in the [release guide](release/README.md).
- [ ] Download and verify the CLI's matching release bundle; retain it and the operator
      outside npm's temporary cache. Pin installations; never resolve latest during startup.
- [ ] Test a complete release on a clean supported machine through administrator login
      and a real model response, then publish the matching npm CLI, GitHub assets and GHCR images.

## Upgrade decision

- [ ] Decide whether to retain the custom local replacement/upgrade feature or defer it.
      Its [upgrade implementation](scripts/deployment/upgrade.ts), state and Python helper total
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

- [ ] Fix or document the cloud-owner device-login session edge case: WorkOS’s approval
      page can say “You must be signed in to continue” instead of starting sign-in.
      Signing in through the cloud and returning to the pending code succeeded. Reproduce
      fresh and expired provider sessions before declaring installer login fully finished.

## Future decisions

- [ ] Refine the illustrative Team documents recipe and verify its actual workflow;
      choose packs/Connections explicitly rather than treating the example as a finished product.
- [ ] Curate the built-in plugin/channel/skill surface and remove ClawHub mentions.
      Keep user-added plugins/MCP possible; evaluate document dependencies per recipe.
      Native Lobster is required.
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
