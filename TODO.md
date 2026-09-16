# Remaining work

Select one slice at a time. This checklist does not authorize automatic continuation.
Code reduction comes before new installation features. Current configuration and limits are in
[README.md](README.md#installation-management-direction).

## Code reduction — selected work

Preserve protected Gateway/worker execution, authenticated team entry and revocation,
LiteLLM, optional Connections and existing native edits. These are requirements;
the current files, command surfaces and orchestration mechanisms are not.
After each slice, update affected docs and callers, run relevant checks, and report
net changes separately for authored implementation, tests and generated code.
Moving code or deleting a one-caller wrapper is not a substantial code reduction.

- [ ] **5. Separate release inputs from installation inputs.** Change
      [release creation](scripts/release/create.ts) to accept images, tools, version/source
      and recipes from the release contract; eliminate dummy administrator, port and
      deployment settings. Give non-TypeScript payload staging one owner in
      [release packaging](scripts/release/operator.ts), shared by build and archive creation.
- [ ] **6. Use one installation-operation lock.** Consolidate the outer operator lock
      in [plan/apply](scripts/installation/plan.ts) and the retained-state lock in
      [local state](scripts/local/state.ts). Shared operation entry points acquire it
      once, including before initial directory creation; internal functions do not
      reacquire it. Cover prepare/start/upgrade/Connections concurrency before removal.
- [ ] **7. Consolidate model/pack command entry points.** Register existing model and
      pack command factories under the public CLI and use its error presentation;
      remove independent operator parsers/entry points. Keep the tiny pack executable
      required inside the runtime image. Move the documented native-preset renderer
      under the public CLI without introducing another configuration implementation.
- [ ] **8. Remove Connections algorithm duplication and file fragmentation.** Share
      the repeated JSON traversal/canonicalization currently in domain validation,
      catalog artifacts and Composio wire handling; preserve each boundary's limits
      and error translation. Move the sole-use `paged` helper into its connection store
      and remove [repo/pagination.ts](services/connections/repo/pagination.ts).
      Do not inline the revision parser twice or replace small helpers with a framework.

## Larger code reductions — decide the replacement or lost behavior first

- [ ] Verify a supported shared fetch-runtime dependency before replacing the three
      identical generated transport trees (1,926 lines each; 3,852 duplicate lines).
      The installed generator supports an external runtime package, not a shared-local-path
      setting. Do not patch emitted imports or delete transitively used generated helpers.
- [ ] Decide whether to retain the custom local replacement/upgrade feature or defer it.
      Its [upgrade implementation](scripts/local/upgrade.ts), state and Python helper total
      580 lines, with additional startup-gate code/tests. The gate exists for this workflow;
      removing it alone would break replacement. Retained-volume startup remains required.
- [ ] Specify a smaller owner for local process/network orchestration before replacing
      [launch/supervision](scripts/local/launch.ts), private status/stop control,
      network allocation and runtime receipts. Identify the exact Compose/OpenShell
      operations taking over each responsibility. None of these modules is dead code;
      preserve two protected runtimes, resource ownership and reliable stop/start.
- [ ] Decide which optional Connections extras to keep: offline retirement preflight
      (86-line helper plus CLI/types), extracted file-field hints (57-line helper plus
      contract/import paths), and large saved-result paging (481 lines across five modules
      plus API/plugin/SQL paths). Removing them loses those specific capabilities.
      Keep exact account grants, execution receipts, no-blind-replay guarantees and
      eventual cleanup of cancelled/disconnected provider accounts. Live catalog
      publication is a separate 376-line feature needing a safe update replacement.

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

## Installation backlog — after code reduction, select before implementation

- [ ] **Finish retained-install capability changes.** Initial models, Connections
      and pack selections are wired. Add reviewed capability change/reapply operations
      to the unified installation CLI: model routes/keys, broker settings/keys,
      enable/disable and pack selection changes. Reuse the existing component operators;
      preserve native edits, revoked credentials and uncertain outcomes. Current
      preparation rejects changed inputs rather than silently applying them.
- [ ] Finish the development build-to-release command and published release selection
      (latest stable by default, explicit version override); no test-directory inputs
      or developer-source selection in the interactive menu.
- [ ] **Verify and publish the supported release.** Build exact images and operator;
      generate the release file, verify it on a fresh installation, then publish downloads,
      checksums/notices to GitHub Releases and images to GHCR. Report qualified platforms
      and capability limits; the owner-managed browser issue is not an automatic task.
      Published artifacts must not claim unverified Linux/WSL or team journeys.
- [ ] Implement the selected private, expiring, one-use first-administrator setup link
      for OIDC: authenticate its holder, atomically bind the identity and verify native
      authority. Preserve explicit subject bootstrap for unattended configuration.
- [ ] Develop and qualify the illustrative Team documents recipe separately. Intended
      default route: OpenRouter GPT-6 Astra / medium; verify live inference and decide packs and
      whether Connections belongs in it. Do not turn the example into an automatic task.

## Separate decisions and integrations

- [ ] Investigate the intermittent POSIX [process-group cleanup test](tests/local/supervisor.test.ts)
      failure under the parallel suite; isolated tests pass.
      Preserve structured signal failure diagnostics before changing cleanup timing.
- [ ] Decide ongoing People enrollment UX (admission requests or invite links); qualify
      two-person login and revocation. Connections account OAuth guidance through the
      installer is separate future work; Connections currently defaults to disabled.
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
