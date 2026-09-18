# TODO

Open work only. Select a task before implementing; this list does not authorize continuation.

## Hosted login and native Connections

Selected design: [hosted login and Connections](docs/cloud-services.md). Stages in order;
payment integration and privately operated broker packaging come later.
Hosted login and automatic installer registration are verified locally through native
administrator access and a real model response. M3 is complete. M4 cloud broker/API and
database tests are implemented. The dedicated provider project/key and real setup allocation work.
Real Outlook consent passed; external execution and CLI acceptance remain pending. M5 quotas passed real
PostgreSQL/HTTP regressions. M6 native UI/CLI and its administrator-checking adapter
are implemented. Native catalog, edit/removal, loading, CLI management and protected
runtime-to-cloud search have passed locally; real consent passed, while reconnect and external tool execution remain pending.
No cloud deployment yet. Development releases must supply or override the cloud URL.

Use the [existing-code map](docs/cloud-services.md#reuse-and-new-work) throughout;
native Connections replacement is part of this same batch, not a separate future task.

- [ ] **M4 — Run Connections in the cloud.** Move reviewed broker/catalog/provider code and
      regressions; replace local-session coupling with installation scope. Link a real account and
      execute one tool through API/CLI, proving scoped management denial and runtime revocation.
      Adapt scheduled cleanup and provider deadlines using Kora's cloud deployment as the reference.
- [ ] **M6 — Finish native Connections acceptance.** Real Outlook consent is verified.
      Resolve optional tool arguments on the direct-OpenAI Responses route: OpenClaw
      omits `strict`, ignores the configured compatibility flag on this path, and the
      model invents optional search IDs/cursors. Explicit `strict: false` passed the
      isolated LiteLLM request; native chat still fails. Keep OpenClaw vanilla.
      Verify reconnect/disconnect and one real tool execution.
      Native UI/CLI, administrator/member/CSRF/revocation enforcement and packaging are implemented
      and tested. Removing the previous installer/local broker paths remains M7.
- [ ] **M7 — Complete installation and replacement.** Wire independent login/broker choices
      through recipes, settings and release artifacts. Verify fresh install and retained reconfiguration,
      disabled/empty Connections, and remove superseded token-login and local broker/UI paths.
- [ ] **M8 — Verify and deploy the combined slice.** Run the complete hosted-login and custom-OIDC
      journeys with native Connections, multiple installations, tenant isolation and quota/revocation
      failures. Deploy the tested artifacts, update actual status and clean up disposable infrastructure.

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

## Future decisions

- [ ] Refine the illustrative Team documents recipe and verify its actual workflow;
      choose packs/Connections explicitly rather than treating the example as a finished product.
- [ ] Select Lobster, Codex or other optional packs individually. Preserve vanilla ClawHub
      discovery unless a supported curation approach is explicitly selected.
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
