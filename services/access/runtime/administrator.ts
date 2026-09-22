import type { FastifyRequest } from "fastify";
import type { AccessRuntimeApi, NativeAuthority } from "../types/native.js";
import { AccessError } from "../types/errors.js";

/** Every management call proves current native authority, including after the native read. */
export function administratorProof(input: {
  access: AccessRuntimeApi;
  native: NativeAuthority;
  origin: string;
}) {
  return async (request: FastifyRequest) => {
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
    if (!(await input.access.resolveSessionHash(session.hash)))
      throw new AccessError("unauthenticated", "Sign in to continue.");
    return {
      userId: session.user.id,
      origin: input.origin,
      sessionHash: session.hash,
      verifiedAt: new Date().toISOString(),
      agentIds: native.agentIds,
    };
  };
}
