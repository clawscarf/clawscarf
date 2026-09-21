import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { createIngress } from "../../services/access/providers/ingress.js";

await test(
  "native widget forwarding remains usable after upstream keep-alive expiry",
  { skip: !process.env.CLAWSCARF_TEST_WIDGET_FORWARD, timeout: 20000 },
  async () => {
    const target = process.env.CLAWSCARF_TEST_WIDGET_FORWARD;
    assert.ok(target);
    const url = new URL(target);
    assert.equal(url.protocol, "http:");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.origin, target);
    const route = {
      kind: "widget" as const,
      origin: "http://127.0.0.1",
      upstream: target,
    };
    const ingress = createIngress(
      { authenticate: () => Promise.reject(Error("Widget host is public")) },
      [route],
      () => {},
    );
    ingress.server.listen(0, "127.0.0.1");
    await once(ingress.server, "listening");
    const address = ingress.server.address();
    assert.ok(address && typeof address !== "string");
    route.origin = `http://127.0.0.1:${address.port}`;
    const probe = async () => {
      const response = await fetch(`${route.origin}/mcp-app-sandbox`, {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/u);
      assert.ok((await response.text()).length > 0);
    };
    try {
      await probe();
      // The pinned native server advertises timeout=5. Cross that idle boundary.
      await setTimeout(7000);
      await probe();
      await Promise.all(Array.from({ length: 40 }, probe));
    } finally {
      await ingress.close();
    }
  },
);
