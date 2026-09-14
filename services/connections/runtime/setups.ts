import type { RouteHandlers } from "../generated/server/fastify.gen.js";
import { principal } from "./authentication.js";
import type { ConnectionSetupService } from "../service/setup-service.js";
import { connectionRevision } from "./parameters.js";

export function connectionSetupHandlers(
  scope: { serverId: string },
  service: ConnectionSetupService,
) {
  return {
    async startConnectionSetup(request, reply) {
      const started = await service.start(
        principal(request),
        scope,
        request.params.connectionId,
        connectionRevision(request.headers["if-match"]),
        request.headers["idempotency-key"],
        request.body.kind,
      );
      return reply
        .header("Cache-Control", "no-store")
        .header(
          "Location",
          `/_clawscarf/connections/v1/connections/${request.params.connectionId}/setups/${started.setup.id}`,
        )
        .code(202)
        .send(started);
    },
    async getConnectionSetup(request, reply) {
      return reply
        .header("Cache-Control", "no-store")
        .code(200)
        .send(
          await service.get(
            principal(request),
            scope,
            request.params.connectionId,
            request.params.setupId,
          ),
        );
    },
    async cancelConnectionSetup(request, reply) {
      return reply
        .code(200)
        .send(
          await service.cancel(
            principal(request),
            scope,
            request.params.connectionId,
            request.params.setupId,
            connectionRevision(request.headers["if-match"]),
            request.headers["idempotency-key"],
          ),
        );
    },
  } satisfies Partial<RouteHandlers>;
}
