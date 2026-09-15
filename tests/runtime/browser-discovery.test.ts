import assert from "node:assert/strict";
import { createServer, get, type Server } from "node:http";
import { test } from "node:test";
import {
  discoveryRequest,
  rewriteDiscovery,
  writeDiscoveryResponse,
} from "../../deploy/execution/browser/discovery.js";

await test("CDP discovery uses the original authority, not forwarded headers or credentials", () => {
  for (const host of [
    "runtime.clawscarf.internal:9223",
    "127.0.0.1:19876",
    "[::1]:19876",
  ]) {
    const request = discoveryRequest({
      method: "GET",
      url: "/json/version",
      headers: {
        host,
        authorization: "Bearer private",
        "x-forwarded-host": "other.example:443",
        "x-forwarded-proto": "https",
      },
    });
    assert.ok(request);
    const endpoint = `ws://${host}/devtools/browser/current`;
    assert.deepEqual(
      rewriteDiscovery(
        {
          Browser: "Chrome/152",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/current",
        },
        request,
      ),
      { Browser: "Chrome/152", webSocketDebuggerUrl: endpoint },
    );
    assert.deepEqual(
      rewriteDiscovery(
        {
          webSocketDebuggerUrl:
            "ws://127.0.0.1:9222/devtools/browser/restarted",
        },
        request,
      ),
      { webSocketDebuggerUrl: `ws://${host}/devtools/browser/restarted` },
    );
  }
  for (const host of [
    undefined,
    "user:secret@browser:9223",
    "browser:9223/path",
    "browser:9223?query",
    "browser:9223#fragment",
    "browser:9223\\path",
    "browser:99999",
    "browser:9223 ",
  ]) {
    assert.throws(() =>
      discoveryRequest({
        method: "GET",
        url: "/json/version",
        headers: host ? { host } : {},
      }),
    );
  }
  assert.equal(
    discoveryRequest({
      method: "GET",
      url: "/devtools/browser/current",
      headers: {},
    }),
    undefined,
  );
  const request = discoveryRequest({
    method: "GET",
    url: "/json/list",
    headers: { host: "browser:9223" },
  });
  assert.ok(request);
  assert.deepEqual(
    rewriteDiscovery(
      [
        {
          id: "a",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/a",
        },
        { id: "no-endpoint", type: "worker" },
      ],
      request,
    ),
    [
      { id: "a", webSocketDebuggerUrl: "ws://browser:9223/devtools/page/a" },
      { id: "no-endpoint", type: "worker" },
    ],
  );
  assert.throws(() => rewriteDiscovery({}, request));
  const object = { ...request, shape: "object" as const };
  for (const endpoint of [
    "ws://other.example:9222/devtools/browser/id",
    "ws://127.0.0.1:9333/devtools/browser/id",
    "ws://user:secret@127.0.0.1:9222/devtools/browser/id",
    "ws://127.0.0.1:9222/not-cdp",
    "ws://127.0.0.1:9222/devtools/browser/id?token=secret",
    "ws://127.0.0.1:9222/devtools/browser/id#fragment",
  ])
    assert.throws(() =>
      rewriteDiscovery({ webSocketDebuggerUrl: endpoint }, object),
    );
  assert.throws(() => rewriteDiscovery({}, object));
});

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

await test("discovery response transformation is bounded and frames UTF-8 JSON and errors correctly", async () => {
  const source = createServer((request, response) => {
    const body =
      request.url === "/large"
        ? "a".repeat(1024 * 1024 + 1)
        : request.url === "/invalid"
          ? "not-json"
          : request.url === "/missing"
            ? "No such endpoint"
            : JSON.stringify({
                Browser: "é",
                webSocketDebuggerUrl:
                  "ws://127.0.0.1:9222/devtools/browser/current",
              });
    response.writeHead(request.url === "/missing" ? 404 : 200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    response.end(body);
  });
  const sourceOrigin = await listen(source);
  const front = createServer((request, response) => {
    const upstreamRequest = get(
      sourceOrigin + (request.url ?? "/"),
      (upstream) => {
        void writeDiscoveryResponse(upstream, response, {
          origin: "http://browser:9223",
          shape: "object",
        }).catch(() => {
          if (!response.headersSent) {
            response.writeHead(502);
            response.end();
          } else response.destroy();
          upstream.destroy();
        });
      },
    );
    upstreamRequest.once("error", () => {
      response.writeHead(502);
      response.end();
    });
  });
  try {
    const origin = await listen(front);
    const response = await fetch(origin);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.text();
    assert.equal(
      Number(response.headers.get("content-length")),
      Buffer.byteLength(body),
    );
    assert.deepEqual(JSON.parse(body), {
      Browser: "é",
      webSocketDebuggerUrl: "ws://browser:9223/devtools/browser/current",
    });
    for (const path of ["/large", "/invalid"]) {
      const failed = await fetch(origin + path, {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(failed.status, 502);
      await failed.body?.cancel();
    }
    const missing = await fetch(origin + "/missing");
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), "No such endpoint");
  } finally {
    await close(front);
    await close(source);
  }
});
