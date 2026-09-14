import type { RouteHandlers } from "../generated/server/fastify.gen.js";
import { principal, sessionCookie } from "./authentication.js";
import type { ConnectionReturnService } from "../service/return-service.js";
import { CONNECTION_RETURN_TTL_SECONDS } from "../types/returns.js";
import { ConnectionError } from "../types/errors.js";

const cookieName = "clawscarf_connection_return";

export function connectionReturnHandlers(
  service: ConnectionReturnService,
  origin: string,
) {
  return {
    async stageConnectionReturn(request, reply) {
      reply.header("Cache-Control", "no-store");
      try {
        const staged = await service.stage(
          request.query.session_uri,
          request.cookies[cookieName],
        );
        sessionCookie(
          reply,
          origin,
          cookieName,
          staged.cookie,
          CONNECTION_RETURN_TTL_SECONDS,
        );
        return reply.redirect(
          `/_clawscarf/connections/return/${staged.id}`,
          303,
        );
      } catch (error) {
        if (
          !(error instanceof ConnectionError) ||
          error.code !== "connection_return_capacity"
        )
          throw error;
        return reply.redirect("/_clawscarf/connections/return", 303);
      }
    },
    async completeConnectionReturn(request, reply) {
      return reply
        .header("Cache-Control", "no-store")
        .code(200)
        .send(
          await service.complete(
            principal(request),
            request.params.returnId,
            request.cookies[cookieName],
          ),
        );
    },
  } satisfies Partial<RouteHandlers>;
}
