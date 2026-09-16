import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { safeReturn } from "../../services/access/service/session.js";
import { SessionLogoutProtection } from "../../services/access/repo/session-logout.js";
import { cleanHeaders } from "../../services/access/providers/ingress.js";
import {
  SessionStreams,
  type TrackedStream,
} from "../../services/access/providers/streams.js";

await test("return paths preserve native navigation without open redirects or auth loops", () => {
  for (const value of [
    "/",
    "/settings/models",
    "/sessions?agent=main",
    "/_clawscarf/team/",
    "/_clawscarf/account/",
  ])
    assert.equal(safeReturn(value), value);
  for (const value of [
    "//evil.example",
    "https://evil.example",
    "/\\evil",
    "/_clawscarf/callback",
    "/_clawscarf/connections/",
    "/_clawscarf/connections/return/abc",
    "/_clawscarf/connections/verify",
    "/_clawscarf/connections/v1/connections",
    "/x#fragment",
    "/x\nheader",
  ])
    assert.throws(() => safeReturn(value));
});
await test("session logout URLs are encrypted and bound to one session", () => {
  const protection = new SessionLogoutProtection(randomBytes(32));
  const url = "https://id.example/logout?id_token_hint=private";
  const sealed = protection.seal("session", url);
  assert.ok(!sealed.includes("private"));
  assert.equal(protection.open("session", sealed), url);
  assert.throws(() => protection.open("another", sealed));
});
await test("ingress removes identity, authorization and proxy evidence from callers", () => {
  const headers = {
    "x-openclaw-user": "attacker",
    "x-openclaw-scopes": "operator.admin",
    "x-real-ip": "1.2.3.4",
    "x-forwarded-for": "5.6.7.8",
    forwarded: "for=evil",
    cookie: "secret",
    authorization: "Bearer evil",
    accept: "text/html",
  };
  cleanHeaders(headers);
  assert.deepEqual(headers, { accept: "text/html" });
});
await test("revocation closes affected streams while successful checks preserve existing connections", async () => {
  let allowed = true,
    closed = 0;
  const streams = new SessionStreams({
    authenticate: () => {
      if (!allowed) throw Error("revoked");
      return Promise.resolve({ identity: "clawscarf:one" });
    },
  });
  const stream: TrackedStream = {
    session: "one",
    identity: "clawscarf:one",
    checkedAt: performance.now(),
    close() {
      closed++;
      streams.active.delete(stream);
    },
  };
  streams.active.add(stream);
  streams.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, 0);
  allowed = false;
  streams.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, 1);
  streams.close();
});
await test("unresolved checks are not duplicated and expire only after failed freshness", () => {
  let calls = 0,
    closed = 0;
  const streams = new SessionStreams({
    authenticate: () => {
      calls++;
      return new Promise(() => undefined);
    },
  });
  const stream: TrackedStream = {
    session: "one",
    identity: "clawscarf:one",
    checkedAt: performance.now(),
    close() {
      closed++;
      streams.active.delete(stream);
    },
  };
  streams.active.add(stream);
  streams.tick();
  streams.tick();
  assert.equal(calls, 1);
  assert.equal(closed, 0);
  stream.checkedAt = performance.now() - 16000;
  streams.tick();
  assert.equal(closed, 1);
  streams.close();
});

await test("HTTP ingress preserves streaming, replaces forged identity and revokes without replay", async () => {
  const { createServer } = await import("node:http");
  const { createIngress } =
    await import("../../services/access/providers/ingress.js");
  let forwarded: import("node:http").IncomingHttpHeaders | undefined;
  let allowed = true,
    calls = 0;
  const upstream = createServer((req, res) => {
    calls++;
    forwarded = { ...req.headers };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: ready\n\n");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const target = upstream.address();
  assert.ok(target && typeof target !== "string");
  const route: import("../../services/access/types/ingress.js").RuntimeRoute = {
    kind: "application",
    origin: "http://127.0.0.1:19999",
    upstream: `http://127.0.0.1:${target.port}`,
  };
  const proxy = createIngress(
    {
      authenticate: () =>
        allowed
          ? Promise.resolve({ identity: "clawscarf:actual" })
          : Promise.reject(Error("revoked")),
    },
    [route],
    true,
    () => {
      throw Error("unused");
    },
  );
  proxy.server.listen(0, "127.0.0.1");
  await once(proxy.server, "listening");
  const listener = proxy.server.address();
  assert.ok(listener && typeof listener !== "string");
  route.origin = `http://127.0.0.1:${listener.port}`;
  try {
    const response = await fetch(`http://127.0.0.1:${listener.port}/events`, {
      headers: {
        cookie: "clawscarf_session=secret",
        "x-openclaw-user": "attacker",
        "x-forwarded-for": "203.0.113.5",
      },
    });
    assert.equal(response.status, 200);
    assert.equal(forwarded?.["x-openclaw-user"], "clawscarf:actual");
    assert.equal(forwarded?.["x-forwarded-for"], "127.0.0.1");
    assert.equal(forwarded?.cookie, undefined);
    const reader = response.body?.getReader();
    assert.ok(reader);
    assert.ok((await reader.read()).value);
    allowed = false;
    proxy.streams.tick();
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(reader.read());
    assert.equal(calls, 1);
  } finally {
    await proxy.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

await test("reserved application return paths require an explicit composition grant", () => {
  const allowed = (path: string) => path === "/_clawscarf/example/";
  assert.throws(() => safeReturn("/_clawscarf/example/"));
  assert.equal(
    safeReturn("/_clawscarf/example/?item=1", allowed),
    "/_clawscarf/example/?item=1",
  );
  for (const path of [
    "//evil.invalid/",
    "https://evil.invalid/",
    "/_clawscarf/example/../logout",
    "/_clawscarf/logout",
    "/_clawscarf/example/#fragment",
  ])
    assert.throws(() => safeReturn(path, allowed));
});
