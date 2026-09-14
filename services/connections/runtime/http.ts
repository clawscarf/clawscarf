import type { FastifyInstance } from "fastify";
import openapiGlue from "fastify-openapi-glue";
import staticFiles from "@fastify/static";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import type { AccessRuntimeApi } from "../../access/types/native.js";
import type { ConnectionsService } from "../composition.js";
import type { RouteHandlers } from "../generated/server/fastify.gen.js";
import {
  isDomainError,
  CommonError,
  type FailureCategory,
} from "../shared/errors.js";
import { connectionHandlers } from "./connections.js";
import { connectionSetupHandlers } from "./setups.js";
import { connectionReturnHandlers } from "./returns.js";
import { connectorBrokerHandlers } from "./broker.js";
import {
  principal,
  registerConnectionAuthentication,
} from "./authentication.js";
const statuses = {
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  precondition_failed: 412,
  rate_limited: 429,
  unavailable: 503,
  payment_required: 402,
  internal: 500,
} satisfies Record<FailureCategory, number>;

export async function registerConnectionsHttp(
  app: FastifyInstance,
  input: {
    service: ConnectionsService | null;
    access: AccessRuntimeApi;
    origin: string;
    webRoot?: string;
  },
) {
  await app.register(async (routes) => {
    const securityHandlers = registerConnectionAuthentication(
      routes,
      input.access,
      input.service,
    );
    routes.setErrorHandler((failure, request, reply) => {
      // The OpenAPI library wraps rejected security handlers in a structured aggregate.
      const error =
        failure instanceof Error &&
        failure.name === "Unauthorized" &&
        "errors" in failure &&
        Array.isArray(failure.errors) &&
        failure.errors.length === 1
          ? (failure.errors[0] as unknown)
          : failure;
      if (!isDomainError(error)) throw error;
      const status = statuses[error.category];
      void reply.code(status).type("application/problem+json").send({
        type: "about:blank",
        title: error.code,
        status,
        code: error.code,
        detail: error.message,
        requestId: request.id,
        retry: error.retry,
      });
    });
    const service = input.service;
    if (!service) {
      const source = z
        .object({
          openapi: z.string(),
          info: z.record(z.string(), z.unknown()),
          paths: z.record(z.string(), z.unknown()),
          components: z.record(z.string(), z.unknown()),
        })
        .parse(
          JSON.parse(
            await readFile(new URL("../openapi.json", import.meta.url), "utf8"),
          ),
        );
      const path = "/_clawscarf/connections/v1/connection-capabilities";
      await routes.register(openapiGlue, {
        securityHandlers,
        specification: { ...source, paths: { [path]: source.paths[path] } },
        serviceHandlers: {
          getConnectionCapabilities: async (_req, reply) =>
            reply.code(200).send({ enabled: false }),
        } satisfies Pick<RouteHandlers, "getConnectionCapabilities">,
      });
    } else {
      const handlers = {
        ...connectionHandlers(service.scope, service.service, service.refresh),
        ...connectionSetupHandlers(service.scope, service.setups),
        ...connectionReturnHandlers(service.returns, input.origin),
        ...connectorBrokerHandlers(service.broker),
        rotateConnectionCredential: async (req, reply) =>
          reply
            .header("Cache-Control", "no-store")
            .code(200)
            .send(
              await service.credentialManagement.rotate(
                principal(req),
                service.scope,
              ),
            ),
        revokeConnectionCredential: async (req, reply) => {
          await service.credentialManagement.revoke(
            principal(req),
            service.scope,
          );
          return reply.code(204).send();
        },
        getConnectionCapabilities: async (_req, reply) =>
          reply.code(200).send({ enabled: service !== null }),
        listConnectionAgents: async (req, reply) => {
          const proof = await service.verifyAdministrator(
            principal(req),
            service.scope,
          );
          return reply
            .code(200)
            .send({ agents: proof.agentIds.map((id) => ({ id, name: null })) });
        },
        listConnectors: async (req, reply) => {
          const { query, ...filters } = req.query ?? {};
          return reply.code(200).send(
            service.catalog.list({
              ...filters,
              ...(query === undefined ? {} : { text: query }),
            }),
          );
        },
        getConnector: async (req, reply) => {
          const item = service.catalog.get(req.params.connectorId);
          if (!item) throw new CommonError("not_found", "Service not found.");
          return reply.code(200).send(item);
        },
      } satisfies RouteHandlers;
      await routes.register(openapiGlue, {
        securityHandlers,
        specification: fileURLToPath(
          new URL("../openapi.json", import.meta.url),
        ),
        serviceHandlers: handlers,
      });
    }
    if (input.webRoot) {
      await routes.register(staticFiles, {
        root: input.webRoot + "/assets",
        prefix: "/_clawscarf/connections/assets/",
        wildcard: false,
        decorateReply: true,
      });
      const page = async (
        _req: unknown,
        reply: import("fastify").FastifyReply,
      ) => reply.sendFile("index.html", input.webRoot);
      routes.get("/_clawscarf/connections", page);
      routes.get("/_clawscarf/connections/", page);
      routes.get("/_clawscarf/connections/return", page);
      routes.get("/_clawscarf/connections/return/:returnId", page);
    }
  });
}
