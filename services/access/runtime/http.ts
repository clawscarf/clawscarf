import {
  localSignInPage,
  signedOutPage,
  signInFailurePage,
  signInPagePolicy,
  localSignInPagePolicy,
  setupCompletePage,
} from "./pages.js";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyServerOptions,
  LogController,
} from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import openapiGlue from "fastify-openapi-glue";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { EnrollmentService } from "../service/enrollment.js";
import type { NavigationLink } from "../types/native.js";
import type { Session } from "../types/model.js";
import type { FastifyRequest } from "fastify";
import { classifyFailure, failureDiagnostic } from "./failures.js";
import { AccessError } from "../types/errors.js";
import type { SessionService } from "../service/session.js";
import type { RouteHandlers } from "../generated/fastify.gen.js";
declare module "fastify" {
  interface FastifySchema {
    operationId?: string;
  }
}
export async function createAccessHttp(
  service: Pick<
    SessionService,
    | "validateReturn"
    | "startLogin"
    | "completeLogin"
    | "localLogin"
    | "authenticate"
    | "csrf"
    | "logout"
  >,
  origin: string,
  registerApplication?: (app: FastifyInstance) => Promise<void>,
  enrollment?: Pick<
    EnrollmentService,
    | "list"
    | "prepareTeam"
    | "enroll"
    | "remove"
    | "enabled"
    | "setRole"
    | "invitations"
    | "invite"
    | "revokeInvitation"
  >,
  navigationLinks: readonly NavigationLink[] = [],
  logger: FastifyServerOptions["logger"] = { level: "error" },
) {
  for (const link of navigationLinks) service.validateReturn(link.href);
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: false,
    bodyLimit: 256 * 1024,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  const validator = new Ajv2020({
    strict: false,
    coerceTypes: false,
    removeAdditional: false,
  });
  addFormats.default(validator);
  const parameterValidator = new Ajv2020({
    strict: false,
    coerceTypes: "array",
    removeAdditional: false,
  });
  addFormats.default(parameterValidator);
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === "querystring" ||
    httpPart === "params" ||
    httpPart === "headers"
      ? parameterValidator
      : validator
    ).compile(schema),
  );
  app.addHook("onRoute", (route) => {
    if (route.schema?.operationId && !route.schema.querystring)
      route.schema.querystring = {
        type: "object",
        properties: {},
        additionalProperties: false,
      };
  });
  app.addHook("preParsing", async (request, _reply, payload) => {
    if (
      request.routeOptions.schema?.operationId &&
      !request.routeOptions.schema.body &&
      (request.headers["transfer-encoding"] !== undefined ||
        Number(request.headers["content-length"] ?? 0) > 0)
    )
      throw new AccessError(
        "invalid_request",
        "This operation takes no request body.",
      );
    return payload;
  });
  app.setSerializerCompiler(({ schema }) => {
    const valid = validator.compile(schema);
    return (value: unknown) => {
      if (!valid(value)) throw Error("Invalid response.");
      return JSON.stringify(value);
    };
  });
  await app.register(cookie);
  await app.register(formbody);
  const cookies = (
    reply: FastifyReply,
    name: string,
    value: string,
    maxAge: number,
  ) =>
    reply.setCookie(name, value, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(origin).protocol === "https:",
      maxAge,
    });
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Request-Id", req.id);
    reply.header("Referrer-Policy", "no-referrer");
  });
  app.setErrorHandler((error, req, reply) => {
    if (req.routeOptions.url === "/_clawscarf/callback")
      cookies(reply, "clawscarf_login", "", 0);
    const { code, status, bodyTooLarge, category } = classifyFailure(error);
    if (
      req.routeOptions.url === "/_clawscarf/callback" &&
      (code === "forbidden" || code === "email_unverified")
    )
      cookies(reply, "clawscarf_reauthenticate", "1", 31536000);
    if (status >= 500) {
      req.log.error({
        event: "access_request_failed",
        operation: req.routeOptions.schema?.operationId ?? "unregistered",
        status,
        code,
        category,
        ...failureDiagnostic(error),
      });
    }
    if (
      req.headers.accept?.includes("text/html") &&
      [
        "/_clawscarf/login",
        "/_clawscarf/callback",
        "/_clawscarf/local",
        "/_clawscarf/local-sign-in",
        "/_clawscarf/setup-complete",
      ].includes(req.routeOptions.url ?? "")
    ) {
      void reply
        .code(status)
        .header("Content-Security-Policy", signInPagePolicy)
        .type("text/html")
        .send(
          signInFailurePage(
            code,
            code !== "forbidden" &&
              (req.routeOptions.url === "/_clawscarf/local" ||
                req.routeOptions.url === "/_clawscarf/local-sign-in"),
          ),
        );
      return;
    }
    void reply
      .code(status)
      .type("application/problem+json")
      .send({
        type: "about:blank",
        title: code,
        status,
        code,
        detail: bodyTooLarge
          ? "The request body exceeds 256 KiB."
          : error instanceof AccessError
            ? error.message
            : code === "invalid_request"
              ? "Use the documented fields."
              : code === "setup_required"
                ? "Prepare team access before adding people."
                : code === "last_administrator"
                  ? "Keep at least one available administrator."
                  : code === "revision_conflict"
                    ? "Access changed. Refresh before trying again."
                    : code === "request_rejected"
                      ? "OpenClaw rejected the change. Refresh and review the settings."
                      : code === "outcome_unknown"
                        ? "The result could not be confirmed. Refresh before making another change."
                        : "The service is unavailable.",
        requestId: req.id,
      });
  });
  const actor = async (
    req: FastifyRequest,
    mutation: boolean,
  ): Promise<Session> => {
    const session = await service.authenticate(
      req.cookies.clawscarf_session ?? "",
    );
    if (mutation)
      service.csrf(
        session,
        req.headers.origin,
        typeof req.headers["x-csrf-token"] === "string"
          ? req.headers["x-csrf-token"]
          : undefined,
      );
    return session;
  };
  const team = () => {
    if (!enrollment)
      throw new AccessError("forbidden", "Team access is unavailable.");
    return enrollment;
  };
  const handlers = {
    setPersonRole: async (req, reply) => {
      await team().setRole(
        await actor(req, true),
        req.params.userId,
        req.body.role,
        req.body.expectedRole,
      );
      return reply.code(200).send();
    },
    listInvitations: async (req, reply) =>
      reply.code(200).send(await team().invitations(await actor(req, false))),
    createInvitation: async (req, reply) =>
      reply
        .code(200)
        .send(await team().invite(await actor(req, true), req.body.email)),
    revokeInvitation: async (req, reply) => {
      await team().revokeInvitation(
        await actor(req, true),
        req.params.invitationId,
      );
      return reply.code(200).send();
    },
    listPeople: async (req, reply) =>
      reply.code(200).send(await team().list(await actor(req, false))),
    prepareTeam: async (req, reply) => {
      await team().prepareTeam(await actor(req, true));
      return reply.code(200).send();
    },
    enrollPerson: async (req, reply) =>
      reply
        .code(200)
        .send(await team().enroll(await actor(req, true), req.body)),
    removePerson: async (req, reply) => {
      await team().remove(await actor(req, true), req.params.userId);
      return reply.code(200).send();
    },
    health: async (_req, reply) => reply.code(200).send({ status: "ok" }),
    startLogin: async (req, reply) => {
      const result = await service.startLogin(
        req.query?.returnTo ?? "/",
        req.query?.setup,
        req.query?.invitation,
        req.cookies.clawscarf_reauthenticate === "1",
      );
      cookies(reply, "clawscarf_login", result.cookie, 600);
      return reply.redirect(result.url);
    },
    completeLogin: async (req, reply) => {
      const result = await service.completeLogin(
        req.cookies.clawscarf_login ?? "",
        req.query.state,
        origin + req.raw.url,
      );
      cookies(reply, "clawscarf_session", result.session, 43200);
      cookies(reply, "clawscarf_login", "", 0);
      cookies(reply, "clawscarf_reauthenticate", "", 0);
      return reply.redirect(result.returnTo);
    },
    localLogin: async (req, reply) => {
      if (req.headers.origin !== origin)
        throw new AccessError(
          "csrf_failed",
          "Open the sign-in page on this server.",
        );
      const result = await service.localLogin(
        req.body.token,
        req.query?.returnTo ?? "/",
      );
      cookies(reply, "clawscarf_session", result.session, 43200);
      if (req.headers.accept?.includes("text/html"))
        return reply.redirect(result.returnTo);
      return reply.code(200).send({ redirect: result.returnTo });
    },
    session: async (req, reply) => {
      const session = await service.authenticate(
        req.cookies.clawscarf_session ?? "",
      );
      return reply.code(200).send({
        user: session.user,
        csrfToken: session.csrfToken,
        enrollmentEnabled: enrollment?.enabled ?? false,
        links: [...navigationLinks],
      });
    },
    logout: async (req, reply) => {
      const session = await service.authenticate(
        req.cookies.clawscarf_session ?? "",
      );
      service.csrf(
        session,
        req.headers.origin,
        typeof req.headers["x-csrf-token"] === "string"
          ? req.headers["x-csrf-token"]
          : undefined,
      );
      const redirect = await service.logout(session);
      cookies(reply, "clawscarf_session", "", 0);
      cookies(reply, "clawscarf_reauthenticate", "1", 31536000);
      return reply.code(200).send({ redirect });
    },
  } satisfies RouteHandlers;
  await app.register(openapiGlue, {
    specification: fileURLToPath(new URL("../openapi.json", import.meta.url)),
    serviceHandlers: handlers,
  });
  app.get<{ Querystring: { returnTo?: string } }>(
    "/_clawscarf/local-sign-in",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { returnTo: { type: "string", maxLength: 2048 } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) =>
      reply
        .header("Content-Security-Policy", localSignInPagePolicy)
        .header("Referrer-Policy", "same-origin")
        .type("text/html")
        .send(
          localSignInPage(service.validateReturn(req.query?.returnTo ?? "/")),
        ),
  );
  app.get("/_clawscarf/setup-complete", async (req, reply) => {
    await service.authenticate(req.cookies.clawscarf_session ?? "");
    return reply
      .header("Content-Security-Policy", signInPagePolicy)
      .type("text/html")
      .send(setupCompletePage());
  });
  app.get("/_clawscarf/signed-out", async (_req, reply) =>
    reply.type("text/html").send(signedOutPage()),
  );
  try {
    await registerApplication?.(app);
    await app.ready();
    return app;
  } catch (error) {
    await Promise.allSettled([app.close()]);
    throw error;
  }
}
