import type { RouteHandlers } from "../generated/server/fastify.gen.js";
import type { ConnectorBrokerService } from "../service/broker-service.js";
import { connectorPrincipal } from "./authentication.js";

export function connectorBrokerHandlers(service: ConnectorBrokerService) {
  return {
    async searchConnectorRuntime(request, reply) {
      const { context, query, ...filters } = request.body;
      return reply.code(200).send(
        await service.search(connectorPrincipal(request), context, {
          ...filters,
          ...(query === undefined ? {} : { text: query }),
        }),
      );
    },
    async describeConnectorRuntime(request, reply) {
      const { context, connectionId, actionId } = request.body;
      return reply
        .code(200)
        .send(
          await service.describe(
            connectorPrincipal(request),
            context,
            connectionId,
            actionId,
          ),
        );
    },
    async callConnectorRuntime(request, reply) {
      const controller = new AbortController();
      const closed = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      reply.raw.once("close", closed);
      try {
        return reply
          .code(200)
          .send(
            await service.call(
              connectorPrincipal(request),
              request.body,
              controller.signal,
            ),
          );
      } finally {
        reply.raw.off("close", closed);
      }
    },
    async getConnectorRuntimeInvocation(request, reply) {
      return reply
        .code(200)
        .send(
          await service.getInvocation(
            connectorPrincipal(request),
            request.query.agentId,
            request.params.invocationId,
          ),
        );
    },
    async getConnectorRuntimeResultPage(request, reply) {
      return reply
        .code(200)
        .send(
          await service.getResultPage(
            connectorPrincipal(request),
            request.query.agentId,
            request.params.invocationId,
            request.query.cursor,
          ),
        );
    },
    async lookupConnectorRuntimeInvocation(request, reply) {
      return reply
        .code(200)
        .send(
          await service.lookupInvocation(
            connectorPrincipal(request),
            request.body.context,
            request.body.targetToolCallId,
          ),
        );
    },
  } satisfies Partial<RouteHandlers>;
}
