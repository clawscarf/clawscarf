# Browser shared artifacts

## Intent

Support downloads when the browser controller and Chromium use separate containers
with one dedicated shared artifact mount. Preserve the existing native upload and
node-proxy file transports and administrator-only browser permissions.

This is a downstream integration fix; do not submit it upstream without an explicit
owner request. The browser controller must consume the patched source build.

## Required behavior

- `OPENCLAW_BROWSER_SHARED_ARTIFACTS_DIR` is an operator-owned absolute directory,
  present on both sides at the same path. Reject invalid or missing directories;
  absent configuration preserves the upstream Playwright behavior.
- Use Playwright's public `artifactsDir` option with a private directory per CDP
  connection. Clean up failed connections and disconnected sessions.
- Wait for a completed download, then use the native root-bounded file reader.
  Reject traversal, symlinks, hardlinks, nonregular files and files above the native
  proxy limit. Never use Playwright's unchecked filesystem copy for shared artifacts.
- Remove consumed browser artifacts, preserve atomic native output publication,
  cancellation and navigation policy, and return bytes through the existing proxy.
- No team workspace, browser profile, credentials, controller socket or whole tmp
  directory belongs in the shared mount. Deployment owns its capacity and cleanup
  after an unclean exit. No new file service or model-facing transfer tool.

## Verification

Run the shared-artifact, download cancellation, pinned-CDP transport, upload and
proxy-file regressions, extension type checks, and source build. The ClawScarf
[container regression](../../../tests/runtime/browser-transfer.test.ts) must exercise
real Chromium and the packaged native controller, exact upload/download bytes,
cleanup and missing-mount failures. Platform deployment evidence remains owned by
the [browser guide](../../../deploy/execution/browser-node/README.md#verified-release-limits).

Retire the patch when upstream supplies the same supported contract and preserve
the container regression. Do not silently replace this fix with shared credentials,
profile mounts, network widening or administrator-scope changes.
