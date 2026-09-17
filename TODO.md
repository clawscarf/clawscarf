# TODO

Open work only. Select a task before implementing; this list does not authorize continuation.

## Hosted login and native Connections

Selected design: [hosted login and Connections](docs/cloud-services.md). Stages in order;
payment integration and privately operated broker packaging come later.
Current milestone: **M1**. Cloud owner-login routes, generated API contract and
local HTTP/SDK checks are implemented; check/build pass. Real owner-login verification
has passed with the owner-selected account. The new staging key is stored privately;
exact localhost callback/login/logout URLs are configured. Browser sign-out verification
is pending after the automation browser blocked navigation. Existing projects are untouched.
No cloud deployment or M2 registration work has started.

Use the [existing-code map](docs/cloud-services.md#reuse-and-new-work) throughout;
native Connections replacement is part of this same batch, not a separate future task.

- [ ] **M1 — Establish the cloud repository from existing code.** Create
      `~/clawscarf/clawscarf-cloud` with concise contributor rules, notices and initial API contract.
      Reuse Kora's cloud-authentication/deployment patterns and ClawScarf's service conventions;
      start the service and verify its own owner login. No general WorkOS/Vercel feasibility study.
- [ ] **M2 — Register installations.** Implement account ownership, separate management/runtime
      credentials and rotation/revocation. Prove two-account isolation and idempotent SaaS
      provisioning under an existing customer account. Register exact installation OIDC callbacks
      and private client credentials; no second signup or VM machinery.
- [ ] **M3 — Deliver real login.** A fresh installer run establishes the first administrator;
      normal login/logout, account switching, provider recovery and a two-person invitation/revocation
      flow work. Prove customer OIDC without cloud registration. No bundled IdP or token-only default.
- [ ] **M4 — Run Connections in the cloud.** Move reviewed broker/catalog/provider code and
      regressions; replace local-session coupling with installation scope. Link a real account and
      execute one tool through API/CLI, proving scoped management denial and runtime revocation.
      Adapt scheduled cleanup and provider deadlines using Kora's cloud deployment as the reference.
- [ ] **M5 — Enforce quotas.** Add total, per-installation and per-backend execution quotas and
      separate upstream budgets. Prove concurrent limits, duplicate requests and uncertain outcomes
      cannot bypass/double-charge allowance. Set finite free limits; exhausted users can still log in.
- [ ] **M6 — Deliver native Connections.** Replace the external page with native OpenClaw UI
      and matching CLI for linking, reconnect/disconnect, inactive-entry removal, grants and usage.
      Verify a real native-page OAuth/tool journey, member denial and useful loading/error states.
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
