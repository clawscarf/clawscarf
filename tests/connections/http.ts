import { safeReturn } from "../../services/access/service/session.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ConnectionsService } from "../../services/connections/composition.js";
import type { Principal } from "../../services/connections/types/authority.js";
import { createAccessHttp } from "../../services/access/runtime/http.js";
import type {
  Session,
  AccessRuntimeApi,
} from "../../services/access/types/native.js";
import { AccessError } from "../../services/access/types/errors.js";
import { registerConnectionsHttp } from "../../services/connections/runtime/http.js";
import { createClient } from "../../services/connections/generated/client/client/index.js";
import * as api from "../../services/connections/generated/client/sdk.gen.js";
const origin = "http://127.0.0.1:18899";
const base = "/_clawscarf/connections/v1";
export async function createConnectionsHttpFixture(
  service: ConnectionsService | null,
  actor: Principal,
  webRoot?: string,
) {
  const session: Session = {
    hash: actor.sessionHash,
    user: {
      ...actor.user,
      identity: "clawscarf:test",
      email: "test@example.invalid",
      name: "Test administrator",
    },
    csrfToken: "test-csrf",
  };
  const access: AccessRuntimeApi = {
    authenticate: (value) => {
      if (value !== "test-session")
        throw new AccessError("unauthenticated", "Sign in to continue.");
      return Promise.resolve(session);
    },
    resolveSessionHash: (value) =>
      Promise.resolve(value === session.hash ? session : null),
    csrf: (_session, requestOrigin, value) => {
      if (requestOrigin !== origin || value !== session.csrfToken)
        throw new AccessError(
          "csrf_failed",
          "Refresh before submitting again.",
        );
    },
    withActingSession: async (_hash, work) => work("test-session"),
    withEnrollmentSession: async (_hash, _user, work) => work("test-session"),
  };
  const unused = () => {
    throw Error("Login flow is covered by the access tests.");
  };
  const app = await createAccessHttp(
    {
      ...access,
      validateReturn: safeReturn,
      startLogin: unused,
      completeLogin: unused,
      localLogin: unused,
      logout: unused,
    },
    origin,
    (routes) =>
      registerConnectionsHttp(routes, {
        service,
        access,
        origin,
        ...(webRoot ? { webRoot } : {}),
      }),
  );
  return { app, session, access };
}
/** Exercise registered production routes and generated client against the real repository fixture. */
export async function qualifyConnectionsHttp(
  service: ConnectionsService,
  actor: Principal,
) {
  const { app } = await createConnectionsHttpFixture(service, actor);
  const headers = {
    cookie: "clawscarf_session=test-session",
    origin,
    "x-csrf-token": "test-csrf",
  };
  try {
    const absent = await app.inject({ url: base + "/connections" });
    assert.equal(absent.statusCode, 401, absent.body);
    const csrf = await app.inject({
      method: "POST",
      url: base + "/connections",
      headers: { cookie: headers.cookie, "idempotency-key": randomUUID() },
      payload: {
        connectorId: "test",
        name: "HTTP account",
        grant: { mode: "all" },
      },
    });
    assert.equal(csrf.statusCode, 403, csrf.body);
    const invalid = await app.inject({
      method: "POST",
      url: base + "/connections",
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: {
        connectorId: "test",
        name: "HTTP account",
        grant: { mode: "all" },
        extra: true,
      },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    const list = await app.inject({
      url: base + "/connections?limit=5&includeDisconnected=true",
      headers,
    });
    assert.equal(list.statusCode, 200, list.body);
    const mixed = await app.inject({
      method: "POST",
      url: base + "/connector-runtime/search",
      headers: { ...headers, authorization: "Bearer bad" },
      payload: {
        context: { agentId: "a", toolCallId: "probe" },
        query: "test",
      },
    });
    assert.equal(mixed.statusCode, 401, mixed.body);
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const client = createClient({ baseUrl: address, headers });
    const created = await api.createConnection({
      client,
      throwOnError: true,
      headers: { "idempotency-key": randomUUID() },
      body: {
        connectorId: "test",
        name: "HTTP account",
        grant: { mode: "all" },
      },
    });
    assert.equal(created.data.name, "HTTP account");
    const stale = await api.updateConnection({
      client,
      path: { connectionId: created.data.id },
      headers: { "idempotency-key": randomUUID(), "if-match": '"999999"' },
      body: { name: "Wrong", grant: { mode: "all" } },
    });
    assert.equal(stale.response?.status, 412);
    const rotated = await api.rotateConnectionCredential({
      client,
      throwOnError: true,
    });
    assert.ok(rotated.data.token);
    assert.equal(rotated.response.headers.get("cache-control"), "no-store");
    const token = await service.credentials.authenticate(rotated.data.token);
    assert.equal(token.serverId, service.scope.serverId);
    await api.revokeConnectionCredential({ client, throwOnError: true });
    await assert.rejects(service.credentials.authenticate(rotated.data.token));
  } finally {
    await app.close();
  }
  const { app: disabled } = await createConnectionsHttpFixture(null, actor);
  try {
    const state = await disabled.inject({
      url: base + "/connection-capabilities",
      headers,
    });
    assert.equal(state.statusCode, 200, state.body);
    assert.equal(state.body, '{"enabled":false}');
    assert.equal(
      disabled.hasRoute({ method: "POST", url: base + "/connections" }),
      false,
    );
    assert.equal(
      disabled.hasRoute({
        method: "POST",
        url: base + "/connector-runtime/call",
      }),
      false,
    );
  } finally {
    await disabled.close();
  }
}
