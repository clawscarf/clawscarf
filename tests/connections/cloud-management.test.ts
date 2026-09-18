import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import { registerCloudConnections } from "../../services/connections/cloud/http.js";
import { createAccessHttp } from "../../services/access/runtime/http.js";
import { AccessError } from "../../services/access/types/errors.js";
import { NativeFailure } from "../../services/access/types/native-errors.js";
import type {
  AccessRuntimeApi,
  NativeAuthority,
} from "../../services/access/types/native.js";
import { safeReturn } from "../../services/access/service/session.js";

await test("native Connections adapter rejects members, forged authority, CSRF and revocation; forwards only scoped credentials", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "clawscarf-cloud-ui-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const keyFile = join(dir, "key"),
    key = "a".repeat(43);
  await writeFile(keyFile, key, { mode: 0o600 });
  const cloud = Fastify();
  t.after(() => cloud.close());
  let received = 0;
  const origin = "https://installation.example";
  cloud.all("/api/connections/*", async (req, reply) => {
    received++;
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers["x-csrf-token"], undefined);
    const encoded = req.headers["x-clawscarf-administrator"];
    assert.equal(typeof encoded, "string");
    const assertion = z
      .object({
        userId: z.uuid(),
        origin: z.literal(origin),
        sessionHash: z.string(),
        agentIds: z.array(z.string()),
        verifiedAt: z.iso.datetime(),
      })
      .parse(JSON.parse(Buffer.from(String(encoded), "base64url").toString()));
    assert.deepEqual(assertion.agentIds, ["main"]);
    if (req.method === "POST")
      return reply
        .code(429)
        .type("application/problem+json")
        .send({
          type: "about:blank",
          title: "quota_exhausted",
          code: "quota_exhausted",
          status: 429,
          requestId: randomUUID(),
          quota: {
            scope: "installation",
            unit: "executions",
            limit: 5,
            resetsAt: new Date(Date.now() + 60000).toISOString(),
          },
        });
    return { items: [], nextCursor: null };
  });
  const url = await cloud.listen({ host: "127.0.0.1", port: 0 });
  let admitted = true,
    admin = true,
    revokeDuringRead = false;
  let nativeCalls = 0;
  const session = {
    hash: "b".repeat(64),
    csrfToken: "csrf",
    user: {
      id: randomUUID(),
      identity: "oidc:user",
      name: "Owner",
      email: "owner@example.test",
    },
  };
  const access: AccessRuntimeApi = {
    authenticate: (token) => {
      if (token !== "session" || !admitted)
        throw new AccessError("unauthenticated", "Sign in.");
      return Promise.resolve(session);
    },
    resolveSessionHash: () => Promise.resolve(admitted ? session : null),
    csrf: (_s, o, token) => {
      if (o !== origin || token !== "csrf")
        throw new AccessError("csrf_failed", "Invalid request.");
    },
    withActingSession: (_hash, work) => work("native-credential"),
    withEnrollmentSession: (_hash, _user, work) => work("native-credential"),
  };
  const unused = () => Promise.reject(Error("unused"));
  const native: NativeAuthority = {
    people: unused,
    setRole: unused,
    observeTeam: unused,
    prepareTeam: unused,
    enroll: unused,
    revoke: unused,
    verifyAdministrator: (actor, credential) => {
      nativeCalls++;
      assert.equal(actor.identity, session.user.identity);
      assert.equal(credential, "native-credential");
      if (!admin) throw new NativeFailure("access_denied");
      if (revokeDuringRead) admitted = false;
      return Promise.resolve({ agentIds: ["main"] });
    },
  };
  const app = await createAccessHttp(
    {
      validateReturn: safeReturn,
      startLogin: unused,
      completeLogin: unused,
      authenticate: (token) => access.authenticate(token),
      csrf: (session, origin, token) => access.csrf(session, origin, token),
      logout: unused,
    },
    origin,
    (http) =>
      registerCloudConnections(http, {
        url,
        origin,
        managementKeyFile: keyFile,
        access,
        native,
      }),
  );
  t.after(() => app.close());
  const path = "/_clawscarf/connections/v1/connections";
  const headers = {
    cookie: "clawscarf_session=session",
    origin,
    "x-csrf-token": "csrf",
    "idempotency-key": randomUUID(),
  };
  assert.equal((await app.inject({ url: path })).statusCode, 401);
  admin = false;
  assert.equal(
    (
      await app.inject({
        url: path,
        headers: { ...headers, "x-clawscarf-administrator": "forged" },
      })
    ).statusCode,
    403,
  );
  assert.equal(received, 0);
  admin = true;
  let response = await app.inject({ url: path, headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(received, 1);
  response = await app.inject({
    method: "POST",
    url: path,
    headers: { ...headers, origin: "https://attacker.example" },
    payload: { connectorId: "outlook", name: "Work", grant: { mode: "all" } },
  });
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(received, 1);
  const before = nativeCalls;
  response = await app.inject({
    method: "POST",
    url: path,
    headers,
    payload: { connectorId: "outlook", name: "Work", grant: { mode: "all" } },
  });
  assert.equal(response.statusCode, 429, response.body);
  assert.equal(nativeCalls - before, 1, "one native observation per request");
  assert.match(response.body, /quota_exhausted/);
  assert.doesNotMatch(response.body, new RegExp(key));
  revokeDuringRead = true;
  response = await app.inject({ url: path, headers });
  assert.equal(response.statusCode, 401, response.body);
  assert.equal(received, 2);
});
