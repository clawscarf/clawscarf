import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccessRuntimeApi } from "../../access/types/native.js";
import type { ConnectionsService } from "../composition.js";
import type { Principal } from "../types/authority.js";
import type { ConnectorRuntimePrincipal } from "../types/runtime-auth.js";
import { CommonError } from "../shared/errors.js";

declare module "fastify" {
  interface FastifySchema {
    operationId?: string;
    security?: Array<Record<string, string[]>>;
  }
  interface FastifyRequest {
    connectionActor: Principal | null;
    connectorPrincipal: ConnectorRuntimePrincipal | null;
  }
}
export function registerConnectionAuthentication(
  app: FastifyInstance,
  access: AccessRuntimeApi,
  service: ConnectionsService | null,
) {
  app.decorateRequest("connectionActor", null);
  app.decorateRequest("connectorPrincipal", null);
  return {
    ConnectorRuntime: async (request: FastifyRequest) => {
      const bearer = /^Bearer ([^\s]+)$/i.exec(
        request.headers.authorization ?? "",
      )?.[1];
      if (
        !service ||
        !bearer ||
        bearer.length > 512 ||
        request.headers.cookie !== undefined
      )
        throw new CommonError(
          "unauthenticated",
          "Use this server's connector credential.",
        );
      request.connectorPrincipal =
        await service.credentials.authenticate(bearer);
    },
    BrowserSession: async (request: FastifyRequest) => {
      const session = await access.authenticate(
        request.cookies.clawscarf_session ?? "",
      );
      if (!["GET", "HEAD"].includes(request.method))
        access.csrf(
          session,
          request.headers.origin,
          typeof request.headers["x-csrf-token"] === "string"
            ? request.headers["x-csrf-token"]
            : undefined,
        );
      request.connectionActor = {
        user: { id: session.user.id },
        sessionHash: session.hash,
      };
    },
  };
}
export function principal(request: FastifyRequest): Principal {
  if (!request.connectionActor)
    throw new CommonError("unauthenticated", "Sign in to continue.");
  return request.connectionActor;
}
export function connectorPrincipal(
  request: FastifyRequest,
): ConnectorRuntimePrincipal {
  if (!request.connectorPrincipal)
    throw new CommonError(
      "unauthenticated",
      "Connector authentication is required.",
    );
  return request.connectorPrincipal;
}
export function sessionCookie(
  reply: FastifyReply,
  origin: string,
  name: string,
  value: string,
  maxAge: number,
) {
  reply.setCookie(name, value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(origin).protocol === "https:",
    maxAge,
  });
}
