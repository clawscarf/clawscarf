import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserNodeConfiguration,
  nodeArguments,
  validateBrowserNodeConfiguration,
} from "../../deploy/execution/browser-node/configuration.js";
const cdp = `http://openclaw:${"a".repeat(32)}@browser:9223`;
await test("browser node accepts only the fixed non-executing configuration", () => {
  const config = browserNodeConfiguration(cdp);
  validateBrowserNodeConfiguration(config);
  for (const patch of [
    { tools: { exec: { mode: "full" } } },
    { mcp: { servers: { arbitrary: { url: "https://example.com/mcp" } } } },
    { plugins: { allow: ["browser", "terminal"] } },
    { nodeHost: { workerRuns: { enabled: true } } },
    {
      agents: { list: [{ id: "override", tools: { exec: { mode: "full" } } }] },
    },
  ])
    assert.throws(() =>
      validateBrowserNodeConfiguration({ ...config, ...patch }),
    );
  assert.throws(() => browserNodeConfiguration("http://browser:9223"));
  assert.throws(() => browserNodeConfiguration(cdp + "/other"));
});
await test("native node uses scoped pairing and explicit transport settings", () => {
  const input = {
    gatewayUrl: "wss://node-ingress:443/native",
    displayName: "Team browser",
  };
  const args = nodeArguments({ ...input, pairingCode: "one-use-code" });
  assert.ok(args.includes("--pair"));
  assert.ok(args.includes("--tls"));
  assert.ok(args.includes("/native"));
  assert.ok(!nodeArguments(input).includes("--pair"));
  assert.throws(() =>
    nodeArguments({ ...input, gatewayUrl: "ws://node-ingress" }),
  );
  assert.throws(() =>
    nodeArguments({ ...input, gatewayUrl: "wss://admin:secret@node-ingress" }),
  );
  assert.ok(
    nodeArguments({
      ...input,
      gatewayUrl: "ws://node-ingress",
      allowPrivatePlaintext: true,
    }).includes("--no-tls"),
  );
});
