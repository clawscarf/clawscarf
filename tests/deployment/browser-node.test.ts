import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeBrowserSetupCode } from "../../deploy/execution/browser-node/operator.js";
import { browserNodeReady } from "../../scripts/deployment/browser-node-pairing.js";

await test("native setup code uses an origin without the trailing slash rejected by OpenClaw", () => {
  const code = encodeBrowserSetupCode("wss://10.77.2.29:18803/", {
    token: "one-use-fixture",
    expiresAtMs: 1234,
  });
  assert.deepEqual(JSON.parse(Buffer.from(code, "base64url").toString()), {
    url: "wss://10.77.2.29:18803",
    bootstrapToken: "one-use-fixture",
    expiresAtMs: 1234,
  });
  for (const url of [
    "ws://10.77.2.29:18803",
    "wss://user:pass@example.com",
    "wss://example.com/path",
    "wss://example.com?token=a",
    "wss://example.com#fragment",
  ])
    assert.throws(() =>
      encodeBrowserSetupCode(url, { token: "fixture", expiresAtMs: 1 }),
    );
});

await test("browser readiness requires current admitted connection, not retained pairing history", () => {
  const observed = {
    nodeId: "browser",
    admitted: true,
    connectedAt: 2000,
    disconnectedAt: null,
  };
  assert.equal(browserNodeReady(observed, 1000), true);
  assert.equal(browserNodeReady({ ...observed, admitted: false }, 1000), false);
  assert.equal(
    browserNodeReady({ ...observed, connectedAt: null }, 1000),
    false,
  );
  assert.equal(browserNodeReady(observed, 3000), false);
  assert.equal(
    browserNodeReady({ ...observed, disconnectedAt: 2000 }, 1000),
    false,
  );
  assert.equal(
    browserNodeReady({ ...observed, disconnectedAt: 3000 }, 1000),
    false,
  );
  assert.equal(
    browserNodeReady({ ...observed, disconnectedAt: 500 }, 1000),
    true,
  );
});
