import { AccessError } from "../../access/types/errors.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import openapiGlue from "fastify-openapi-glue";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  AccessRuntimeApi,
  NativeAuthority,
} from "../../access/types/native.js";
import { createClient } from "../../../generated/http/client/index.js";
import * as api from "../../cloud/generated/sdk.gen.js";
import type { RouteHandlers } from "./generated/fastify.gen.js";

/** The installation proves current native authority; neither browser claims nor cloud ownership do so. */
export async function registerCloudConnections(
  app: FastifyInstance,
  input: {
    url: string;
    managementKeyFile: string;
    origin: string;
    access: AccessRuntimeApi;
    native: NativeAuthority;
  },
) {
  const credential = (await readFile(input.managementKeyFile, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(credential))
    throw Error("Invalid Connections management credential.");
  const client = createClient({ baseUrl: input.url, redirect: "error" });
  async function proof(request: FastifyRequest) {
    const session = await input.access.authenticate(
      request.cookies.clawscarf_session ?? "",
    );
    if (request.method !== "GET")
      input.access.csrf(
        session,
        request.headers.origin,
        typeof request.headers["x-csrf-token"] === "string"
          ? request.headers["x-csrf-token"]
          : undefined,
      );
    const native = await input.access.withActingSession(session.hash, (token) =>
      input.native.verifyAdministrator(
        {
          identity: session.user.identity,
          name: session.user.name,
          sessionHash: session.hash,
        },
        token,
      ),
    );
    // A revocation that completed during the native read must deny dispatch too.
    if (!(await input.access.resolveSessionHash(session.hash)))
      throw new AccessError("unauthenticated", "Sign in to continue.");
    return {
      userId: session.user.id,
      origin: input.origin,
      sessionHash: session.hash,
      verifiedAt: new Date().toISOString(),
      agentIds: native.agentIds,
    };
  }
  async function requestOptions(request: FastifyRequest) {
    const assertion = await proof(request);
    return {
      client,
      signal: AbortSignal.timeout(90_000),
      headers: {
        authorization: `Bearer ${credential}`,
        "x-clawscarf-administrator": Buffer.from(
          JSON.stringify(assertion),
        ).toString("base64url"),
        ...(typeof request.headers["idempotency-key"] === "string"
          ? { "idempotency-key": request.headers["idempotency-key"] }
          : {}),
        ...(typeof request.headers["if-match"] === "string"
          ? { "if-match": request.headers["if-match"] }
          : {}),
      },
    };
  }
  function send(
    reply: FastifyReply,
    result: { response?: Response; data?: unknown; error?: unknown },
  ) {
    if (!result.response) throw Error("Connections cloud is unavailable.");
    if (result.error) reply.type("application/problem+json");
    const retry = result.response.headers.get("retry-after");
    if (retry) reply.header("retry-after", retry);
    return reply
      .header("Cache-Control", "no-store")
      .code(result.response.status)
      .send(result.error ?? result.data);
  }
  const handlers = {
    listConnectors: async (r, p) =>
      send(
        p,
        await api.listConnectors({
          ...(await requestOptions(r)),
          query: r.query ?? {},
        }),
      ),
    getConnector: async (r, p) =>
      send(
        p,
        await api.getConnector({
          ...(await requestOptions(r)),
          path: r.params,
        }),
      ),
    listConnections: async (r, p) =>
      send(
        p,
        await api.listConnections({
          ...(await requestOptions(r)),
          query: r.query ?? {},
        }),
      ),
    getConnection: async (r, p) =>
      send(
        p,
        await api.getConnection({
          ...(await requestOptions(r)),
          path: r.params,
        }),
      ),
    createConnection: async (r, p) =>
      send(
        p,
        await api.createConnection({
          ...(await writeOptions(r)),
          body: r.body,
        }),
      ),
    updateConnection: async (r, p) =>
      send(
        p,
        await api.updateConnection({
          ...(await writeOptions(r)),
          path: r.params,
          body: r.body,
        }),
      ),
    disconnectConnection: async (r, p) =>
      send(
        p,
        await api.disconnectConnection({
          ...(await writeOptions(r)),
          path: r.params,
        }),
      ),
    refreshConnection: async (r, p) =>
      send(
        p,
        await api.refreshConnection({
          ...(await writeOptions(r)),
          path: r.params,
        }),
      ),
    startConnectionSetup: async (r, p) =>
      send(
        p,
        await api.startConnectionSetup({
          ...(await writeOptions(r)),
          path: r.params,
          body: r.body,
        }),
      ),
    getConnectionSetup: async (r, p) =>
      send(
        p,
        await api.getConnectionSetup({
          ...(await requestOptions(r)),
          path: r.params,
        }),
      ),
    cancelConnectionSetup: async (r, p) =>
      send(
        p,
        await api.cancelConnectionSetup({
          ...(await writeOptions(r)),
          path: r.params,
        }),
      ),
    completeConnectionSetup: async (r, p) =>
      send(
        p,
        await api.completeConnectionSetup({
          ...(await requestOptions(r)),
          path: r.params,
          body: r.body,
        }),
      ),
    getConnectionUsage: async (r, p) =>
      send(p, await api.getConnectionUsage(await requestOptions(r))),
    listConnectionAgents: async (r, p) =>
      p.code(200).send({
        agents: (await proof(r)).agentIds.map((id) => ({ id, name: null })),
      }),
  } satisfies RouteHandlers;
  async function writeOptions(r: FastifyRequest) {
    const options = await requestOptions(r);
    return {
      ...options,
      headers: {
        ...options.headers,
        "idempotency-key": String(r.headers["idempotency-key"]),
        "if-match": String(r.headers["if-match"]),
      },
    };
  }
  await app.register(openapiGlue, {
    specification: fileURLToPath(new URL("./openapi.json", import.meta.url)),
    serviceHandlers: handlers,
  });
}
