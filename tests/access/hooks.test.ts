import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { projectHookPaths } from "../../services/access/providers/hooks.js";
import { createIngress } from "../../services/access/providers/ingress.js";
import { AccessError } from "../../services/access/types/errors.js";
import type { RuntimeRoute } from "../../services/access/types/ingress.js";
await test("native hook projection enumerates configured authenticated URLs only", () => {
  assert.deepEqual(projectHookPaths({}), []);
  assert.deepEqual(
    projectHookPaths({
      hooks: {
        enabled: true,
        token: "redacted",
        path: "custom",
        mappings: [{ match: { path: "orders/new" } }, { match: {} }],
      },
    }),
    ["/custom/agent", "/custom/orders/new", "/custom/wake"],
  );
  assert.throws(() => projectHookPaths({ hooks: { enabled: true } }));
  assert.throws(() =>
    projectHookPaths({
      hooks: { enabled: true, token: "redacted", path: "/_clawscarf" },
    }),
  );
  assert.throws(() =>
    projectHookPaths({
      hooks: {
        enabled: true,
        token: "redacted",
        mappings: [{ match: { path: "../admin" } }],
      },
    }),
  );
});
await test("only exact hook POSTs retain native credentials; widgets receive no browser authority", async () => {
  let observed: IncomingHttpHeaders | undefined;
  let calls = 0;
  const native = createServer((req, res) => {
    observed = { ...req.headers };
    calls++;
    res.writeHead(
      req.headers.authorization === "Bearer native-test" ? 202 : 401,
    );
    res.end();
  });
  native.listen(0, "127.0.0.1");
  await once(native, "listening");
  const target = native.address();
  assert.ok(target && typeof target !== "string");
  const route: RuntimeRoute = {
    kind: "application",
    origin: "http://127.0.0.1:19999",
    upstream: `http://127.0.0.1:${target.port}`,
    webhookPaths: ["/hooks/wake"],
  };
  const widget: RuntimeRoute = {
    kind: "widget",
    origin: "http://localhost:19999",
    upstream: route.upstream,
  };
  const ingress = createIngress(
    {
      authenticate: () =>
        Promise.reject(new AccessError("unauthenticated", "Sign in.")),
    },
    [route, widget],
    true,
    () => {
      throw Error("Unexpected access dispatch");
    },
  );
  ingress.server.listen(0, "127.0.0.1");
  await once(ingress.server, "listening");
  const bound = ingress.server.address();
  assert.ok(bound && typeof bound !== "string");
  route.origin = `http://127.0.0.1:${bound.port}`;
  widget.origin = `http://localhost:${bound.port}`;
  const headers = {
    authorization: "Bearer native-test",
    cookie: "clawscarf_session=not-authorized",
    "x-openclaw-user": "forged",
    "x-forwarded-for": "203.0.113.1",
  };
  try {
    assert.equal(
      (await fetch(route.origin + "/hooks/wake", { method: "POST", headers }))
        .status,
      202,
    );
    assert.equal(observed?.authorization, "Bearer native-test");
    assert.equal(observed?.cookie, undefined);
    assert.equal(observed?.["x-openclaw-user"], undefined);
    assert.equal(observed?.["x-forwarded-for"], "127.0.0.1");
    assert.equal(
      (await fetch(route.origin + "/hooks/wake", { method: "POST" })).status,
      401,
    );
    assert.equal(calls, 2);
    for (const [path, method] of [
      ["/hooks/wake", "GET"],
      ["/hooks/wake/extra", "POST"],
      ["/hooks/agent", "POST"],
    ] as const)
      assert.equal(
        (await fetch(route.origin + path, { method, headers })).status,
        401,
      );
    assert.equal(calls, 2);
    assert.equal(
      (await fetch(widget.origin + "/widget", { headers })).status,
      401,
    );
    assert.equal(calls, 3);
    assert.equal(observed?.authorization, undefined);
    assert.equal(observed?.cookie, undefined);
    assert.equal(observed?.["x-openclaw-user"], undefined);
  } finally {
    await ingress.close();
    await new Promise<void>((resolve, reject) =>
      native.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
