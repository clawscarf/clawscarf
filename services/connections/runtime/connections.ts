import type { RouteHandlers } from "../generated/server/fastify.gen.js";
import { page } from "../shared/pagination.js";
import { principal } from "./authentication.js";
import type { ConnectionService } from "../service/connection-service.js";
import type { ConnectionRefreshService } from "../service/refresh-service.js";
import { connectionRevision } from "./parameters.js";

export function connectionHandlers(
  scope: { serverId: string },
  service: ConnectionService,
  refresh: ConnectionRefreshService,
) {
  return {
    async listConnections(request, reply) {
      const { limit, cursor } = page(
        request.query?.limit ?? null,
        request.query?.cursor ?? null,
      );
      return reply
        .code(200)
        .send(
          await service.list(
            principal(request),
            scope,
            limit,
            cursor,
            request.query?.includeDisconnected ?? false,
          ),
        );
    },
    async getConnection(request, reply) {
      return reply
        .code(200)
        .send(
          await service.get(
            principal(request),
            scope,
            request.params.connectionId,
          ),
        );
    },
    async createConnection(request, reply) {
      return reply
        .code(201)
        .send(
          await service.create(
            principal(request),
            scope,
            request.headers["idempotency-key"],
            request.body,
          ),
        );
    },
    async updateConnection(request, reply) {
      return reply
        .code(200)
        .send(
          await service.update(
            principal(request),
            scope,
            request.params.connectionId,
            connectionRevision(request.headers["if-match"]),
            request.headers["idempotency-key"],
            request.body,
          ),
        );
    },
    async disconnectConnection(request, reply) {
      return reply
        .code(202)
        .send(
          await service.disconnect(
            principal(request),
            scope,
            request.params.connectionId,
            connectionRevision(request.headers["if-match"]),
            request.headers["idempotency-key"],
          ),
        );
    },
    async refreshConnection(request, reply) {
      return reply
        .code(200)
        .send(
          await refresh.refresh(
            principal(request),
            scope,
            request.params.connectionId,
            connectionRevision(request.headers["if-match"]),
            request.headers["idempotency-key"],
          ),
        );
    },
  } satisfies Partial<RouteHandlers>;
}
