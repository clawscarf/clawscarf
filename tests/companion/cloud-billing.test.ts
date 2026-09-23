import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import { registerCloudConnections } from "../../services/connections/cloud/http.js";
import { registerCloudManagement } from "../../services/cloud/management/http.js";
import type { OwnerAuthorization } from "../../services/cloud/management/owner.js";
import { createAccessHttp } from "../../services/access/runtime/http.js";
import { AccessError } from "../../services/access/types/errors.js";
import { NativeFailure } from "../../services/access/types/native-errors.js";
import type {
  AccessRuntimeApi,
  NativeAuthority,
} from "../../services/access/types/native.js";
import { safeReturn } from "../../services/access/service/session.js";

await test("Cloud billing separates native administration from session-bound financial authority and preserves purchase identity", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-billing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const managementKeyFile = join(directory, "management"),
    credential = "s".repeat(43);
  await writeFile(managementKeyFile, credential, { mode: 0o600 });
  const id = randomUUID(),
    accountId = randomUUID(),
    orderId = randomUUID(),
    returnId = randomUUID();
  const origin = "https://installation.example";
  let received = 0,
    expireOwner = false;
  const purchases: unknown[] = [];
  const returns: unknown[] = [];
  const cloud = Fastify();
  t.after(() => cloud.close());
  cloud.addHook("onRequest", (request, _reply, done) => {
    received++;
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers["x-csrf-token"], undefined);
    const proof = z
      .object({
        origin: z.literal(origin),
        sessionHash: z.string(),
        userId: z.uuid(),
        agentIds: z.array(z.string()),
      })
      .parse(
        JSON.parse(
          Buffer.from(
            String(request.headers["x-clawscarf-administrator"]),
            "base64url",
          ).toString(),
        ),
      );
    assert.deepEqual(proof.agentIds, ["main"]);
    done();
  });
  cloud.get("/api/installations/:id/allowances", (request) => {
    assert.equal(request.headers.authorization, `Bearer ${credential}`);
    return {
      ai: {
        unit: "usd_micros",
        currency: "usd",
        state: "exhausted",
        freeRemaining: 0,
        paidRemaining: 0,
        available: 0,
        usageAsOf: null,
      },
      connections: {
        unit: "executions",
        state: "available",
        freeRemaining: 3,
        paidRemaining: 10,
        available: 13,
        resetsAt: null,
      },
      purchasingAvailable: true,
    };
  });
  cloud.post("/api/installations/:id/billing-returns", (request) => {
    assert.equal(request.headers.authorization, `Bearer ${credential}`);
    assert.equal(z.object({ id: z.string() }).parse(request.params).id, id);
    returns.push(request.body);
    return { returnId };
  });
  cloud.post("/api/billing/checkouts", (request, reply) => {
    assert.equal(request.headers.authorization, "Bearer owner-token");
    purchases.push(request.body);
    if (expireOwner)
      return reply
        .code(401)
        .send({ code: "authentication_required", requestId: randomUUID() });
    return {
      orderId,
      status: "checkout_ready",
      checkoutUrl: "https://checkout.stripe.com/c/pay/example",
      expiresAt: null,
    };
  });
  cloud.get("/api/billing/orders/:orderId", (request) => {
    assert.equal(request.headers.authorization, "Bearer owner-token");
    return {
      id: orderId,
      installationId: id,
      service: "ai",
      offerId: "ai-20",
      quantity: 1,
      currency: "usd",
      amountMinor: 2000,
      grantAmount: 20_000_000,
      status: "paid",
      createdAt: new Date().toISOString(),
      refundedMinor: 0,
      disputedMinor: 0,
    };
  });
  const url = await cloud.listen({ host: "127.0.0.1", port: 0 });
  let admitted = true,
    admin = true,
    revokeDuringRead = false,
    sessionHash = "b".repeat(64);
  const user = {
    id: randomUUID(),
    identity: "oidc:person",
    name: "Admin",
    email: "admin@example.test",
  };
  const session = () => ({ hash: sessionHash, csrfToken: "csrf", user });
  const access: AccessRuntimeApi = {
    authenticate: (token) => {
      if (token !== "session" || !admitted)
        throw new AccessError("unauthenticated", "Sign in.");
      return Promise.resolve(session());
    },
    resolveSessionHash: () => Promise.resolve(admitted ? session() : null),
    csrf: (_s, requestOrigin, token) => {
      if (requestOrigin !== origin || token !== "csrf")
        throw new AccessError("csrf_failed", "Invalid request.");
    },
    withActingSession: (_hash, work) => work("native-key"),
    withEnrollmentSession: (_hash, _user, work) => work("native-key"),
  };
  const unused = () => Promise.reject(Error("Unexpected call"));
  const native: NativeAuthority = {
    people: unused,
    setRole: unused,
    observeTeam: unused,
    prepareTeam: unused,
    enroll: unused,
    revoke: unused,
    verifyAdministrator: (_actor, key) => {
      assert.equal(key, "native-key");
      if (!admin) throw new NativeFailure("access_denied");
      if (revokeDuringRead) admitted = false;
      return Promise.resolve({ agentIds: ["main"] });
    },
  };
  const authorized = new Set<string>();
  const disconnected = {
    state: "disconnected",
    url: null,
    code: null,
    expiresAt: null,
    pollAfterSeconds: 0,
  } as const;
  const owner: OwnerAuthorization = {
    state: (key) =>
      authorized.has(key)
        ? { ...disconnected, state: "authorized" }
        : disconnected,
    start: (key, target) => {
      assert.equal(target.accountId, accountId);
      authorized.add(key);
      return Promise.resolve({ ...disconnected, state: "authorized" });
    },
    poll: (key) => Promise.resolve(owner.state(key)),
    token: (key) => {
      if (!authorized.has(key))
        throw new AccessError(
          "forbidden",
          "Sign in as the Cloud account owner.",
        );
      return "owner-token";
    },
    forget: (key) => {
      authorized.delete(key);
    },
    close: () => authorized.clear(),
  };
  const app = await createAccessHttp(
    {
      validateReturn: safeReturn,
      startLogin: unused,
      completeLogin: unused,
      authenticate: (token) => access.authenticate(token),
      csrf: (...args) => access.csrf(...args),
      logout: unused,
    },
    origin,
    async (http) => {
      await registerCloudManagement(http, {
        services: [
          {
            id,
            accountId,
            url,
            managementKeyFile,
            ai: true,
            connections: true,
          },
        ],
        origin,
        access,
        native,
        owner,
      });
      await registerCloudConnections(http, {
        url,
        origin,
        managementKeyFile,
        access,
        native,
      });
    },
  );
  t.after(() => app.close());
  const base = `/_clawscarf/cloud/${id}`;
  const headers = {
    cookie: "clawscarf_session=session",
    origin,
    "x-csrf-token": "csrf",
  };
  const body = {
    requestId: randomUUID(),
    offerId: "ai-20",
    quantity: 1,
    returnPath: "/plugins/clawscarf-access/account",
  };
  const post = (path: string, payload: Record<string, unknown> = body) =>
    app.inject({ method: "POST", url: base + path, headers, payload });
  assert.equal(
    (await app.inject({ url: base + "/allowances" })).statusCode,
    401,
  );
  admin = false;
  assert.equal(
    (
      await app.inject({
        url: base + "/allowances",
        headers: { ...headers, "x-clawscarf-administrator": "forged" },
      })
    ).statusCode,
    403,
  );
  assert.equal(received, 0);
  const capabilities = await app.inject({
    url: "/_clawscarf/cloud/capabilities",
    headers,
  });
  assert.equal(capabilities.statusCode, 200);
  assert.deepEqual(capabilities.json(), { ai: true, connections: true });
  assert.equal(received, 0);
  admin = true;
  let response = await app.inject({ url: "/_clawscarf/cloud", headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.doesNotMatch(
    response.body,
    new RegExp(`${accountId}|${credential}|managementKeyFile`),
  );
  response = await app.inject({ url: base + "/allowances", headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(
    response.json<{ ai: { state: string } }>().ai.state,
    "exhausted",
  );
  assert.equal((await post("/checkouts")).statusCode, 403);
  assert.equal(purchases.length, 0);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: base + "/authorization",
        payload: {},
        headers: { ...headers, origin: "https://attacker.example" },
      })
    ).statusCode,
    403,
  );
  response = await post("/authorization", {});
  assert.equal(response.statusCode, 200, response.body);
  // Owner sign-in does not grant another local session financial authority.
  sessionHash = "c".repeat(64);
  assert.equal((await post("/checkouts")).statusCode, 403);
  sessionHash = "b".repeat(64);
  for (let n = 0; n < 2; n++) {
    response = await post("/checkouts");
    assert.equal(response.statusCode, 200, response.body);
  }
  assert.deepEqual(purchases, [
    {
      requestId: body.requestId,
      offerId: body.offerId,
      quantity: 1,
      installationId: id,
      returnId,
    },
    {
      requestId: body.requestId,
      offerId: body.offerId,
      quantity: 1,
      installationId: id,
      returnId,
    },
  ]);
  assert.deepEqual(returns, [
    { requestId: body.requestId, path: body.returnPath },
    { requestId: body.requestId, path: body.returnPath },
  ]);
  response = await app.inject({ url: base + "/orders/" + orderId, headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json<{ status: string }>().status, "paid");
  // A receipt is not itself a locally invented credit grant.
  response = await app.inject({ url: base + "/allowances", headers });
  assert.equal(response.json<{ ai: { available: number } }>().ai.available, 0);
  assert.equal(
    (await post("/checkouts", { ...body, returnPath: "//attacker.example" }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        url: `/_clawscarf/cloud/${randomUUID()}/allowances`,
        headers,
      })
    ).statusCode,
    400,
  );
  expireOwner = true;
  assert.equal((await post("/checkouts")).statusCode, 401);
  assert.equal(
    (await app.inject({ url: base + "/authorization", headers })).json<{
      state: string;
    }>().state,
    "disconnected",
  );
  revokeDuringRead = true;
  const before = received;
  assert.equal(
    (await app.inject({ url: base + "/allowances", headers })).statusCode,
    401,
  );
  assert.equal(received, before);
});
