# Remove Cloud Workers

## Intent and dependencies

Keep session execution inside the team Gateway protected by OpenShell. Remove
native Cloud Workers and paired-device session hosting as one slice: both use the
same provisioning and placement service. Apply after `remove-labs` and
`curated-image-inventory` in the recorded series order. This is a source removal,
not a configurable feature flag or an ingress RPC filter. Generated UI catalogs and
boot metadata reflect the preceding stack, including channel and update curation.

The [inventory](../inventory.json) excludes worker provider plugins. Installing a
plugin must not recreate the removed native service. Preserve ordinary local
sessions, worktrees, native permissions and browser-node pairing/management.
Generic node commands and terminal routing belong to separate owners. This patch
removes the publication lifecycle with worker hosting; the later
[GitHub patch](disable-native-github.prompt.md) disables its retained consumers.

## Required behavior

- Remove Cloud Workers navigation, routes, settings/search entries, provisioning
  forms and New Session cloud/device destinations. Remove session move, worker
  stop/restart and automatic placement retry controls. Keep local creation and abort.
- Remove native provisioning, dispatch/move/reclaim and worker desktop RPC
  registrations, cloud-only `desktop.launch`, and worker bootstrap, transfer and
  ingress HTTP handlers. Keep
  local Gateway and ordinary paired-node environment status and desktop observation.
- Do not construct worker provider services, start reconciliation, allocate ready
  pools, synchronize snapshots, recover remote publications or perform provider
  cleanup on Gateway startup or plugin reload.
- Remove `cloudWorkers` and `nodeHost.workerRuns` from accepted configuration and
  schema/form hints. Reject retained configuration visibly before effects. Remove
  the public worker CLI and `connect --session-host`, `connect --ephemeral` and
  `node run --ephemeral`. Ordinary node enrollment remains available without
  enabling session hosting; the private macOS node bridge is a distinct owner.
- Preserve existing placement and environment records without migration, deletion
  or external lease destruction. Read them only for admission/ownership guards:
  nonlocal sessions cannot silently resume locally, cloud-owned nodes cannot
  reconnect as ordinary devices, and historic UI records show unavailability.
  Reject retained cloud-worker bootstrap credentials after startup as well.
  Operators remain responsible for external provider resources already created.
- Retain shared upstream types, storage readers and unregistered helper code where
  needed by existing consumers. Their presence is not a supported worker execution
  path. Do not claim all upstream worker source files have been physically deleted.

## Verification and maintenance

Exercise native method discovery, removed direct calls, configuration rejection,
ordinary environment/node status, local session creation and browser pairing.
Verify retained remote ownership rejects execution before local effects and that
startup/reload never starts provider reconciliation. Test CLI option rejection
before credential consumption and UI local creation, abort and historic errors.
Review desktop/mobile navigation and direct removed routes. Run native type checks,
source build, ClawScarf checks/build and exact patch replay; state separately whether
runtime images were built or deployed. Do not alter a running installation merely
to verify a patch.

On upstream upgrades trace new provisioning, placement, task-suggestion and worker
entry points rather than matching names alone. Keep unrelated subagent workers,
JavaScript workers and browser-node infrastructure. Retire this patch only when
upstream can enforce the same single-Gateway execution boundary without these
surfaces or background effects.
