import type { FastifyInstance } from "fastify";
import type {
  NativeAuthority,
  AccessRuntimeApi,
  NavigationLink,
} from "../types/native.js";
import { OpenClawAuthority } from "../providers/native.js";
import { EnrollmentService } from "../service/enrollment.js";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { DeploymentOidcProvider } from "../providers/oidc.js";
import { openAccessStorage } from "./storage.js";
import { SessionService } from "../service/session.js";
import { createAccessHttp } from "./http.js";
import { createIngress } from "../providers/ingress.js";
import type { CompanionApiRoute, RuntimeRoute } from "../types/ingress.js";
import type { AccessConfiguration } from "./config.js";
export async function composeAccess(
  config: AccessConfiguration,
  registerApplication?: (
    app: FastifyInstance,
    access: AccessRuntimeApi,
    native: NativeAuthority,
    identity: { serverId: string },
  ) => Promise<void>,
  options: {
    native?: NativeAuthority;
    applicationReturnPath?: (path: string) => boolean;
    navigationLinks?: readonly NavigationLink[];
    companionApi?: CompanionApiRoute;
  } = {},
) {
  const storage = await openAccessStorage(config);
  const { repository, identity } = storage;
  let http: FastifyInstance | undefined;
  try {
    const mode = config.identity;
    const provider =
      mode.mode === "oidc"
        ? new DeploymentOidcProvider({
            issuer: mode.issuer,
            clientId: mode.clientId,
            clientSecret: (
              await readFile(mode.clientSecretFile, "utf8")
            ).trim(),
            redirectUri: `${config.origin}/_clawscarf/callback`,
          })
        : null;
    const service = new SessionService(
      repository,
      provider,
      config.origin,
      options.applicationReturnPath,
    );
    const access: AccessRuntimeApi = {
      authenticate: (value) => service.authenticate(value),
      resolveSessionHash: (value) => repository.authenticateSession(value),
      csrf: (session, origin, value) => service.csrf(session, origin, value),
      withEnrollmentSession: (value, userId, work) =>
        service.withEnrollmentSession(value, userId, work),
      withActingSession: (value, work) =>
        service.withActingSession(value, work),
    };
    const native =
      options.native ??
      new OpenClawAuthority(
        config.origin,
        config.runtime.managementOrigin
          ? { endpoint: config.runtime.managementOrigin }
          : {},
      );
    const enrollment = new EnrollmentService(
      repository,
      native,
      config.origin,
      mode.mode === "oidc" ? mode.issuer : null,
    );
    http = await createAccessHttp(
      service,
      config.origin,
      registerApplication
        ? (app) => registerApplication(app, access, native, identity)
        : undefined,
      enrollment,
      fileURLToPath(new URL("../dist/web", import.meta.url)),
      options.navigationLinks,
    );
    const activeHttp = http;
    const routes: RuntimeRoute[] = [
      {
        kind: "application",
        origin: config.origin,
        upstream: config.runtime.origin,
        ...(config.runtime.webhookPaths
          ? { webhookPaths: config.runtime.webhookPaths }
          : {}),
      },
    ];
    if (config.runtime.widgetOrigin && config.runtime.widgetUpstream)
      routes.push({
        kind: "widget",
        origin: config.runtime.widgetOrigin,
        upstream: config.runtime.widgetUpstream,
      });
    const ingress = createIngress(
      {
        authenticate: async (value) => ({
          identity: (await service.authenticate(value)).user.identity,
        }),
      },
      routes,
      mode.mode === "local",
      (req, res) => activeHttp.routing(req, res),
      {
        ...(config.managementTls
          ? {
              management: {
                cert: await readFile(config.managementTls.certificateFile),
                key: await readFile(config.managementTls.keyFile),
              },
            }
          : {}),
        ...(config.applicationTls
          ? {
              application: {
                cert: await readFile(config.applicationTls.certificateFile),
                key: await readFile(config.applicationTls.keyFile),
              },
            }
          : {}),
      },
      options.companionApi,
    );
    return {
      identity,
      native,
      enrollment,
      access,
      repository,
      service,
      http,
      ingress,
      async close() {
        try {
          await ingress.close();
        } finally {
          try {
            await activeHttp.close();
          } finally {
            await storage.close();
          }
        }
      },
    };
  } catch (error) {
    if (http) await Promise.allSettled([http.close()]);
    await storage.close();
    throw error;
  }
}
