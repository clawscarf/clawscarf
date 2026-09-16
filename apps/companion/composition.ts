import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { composeAccess } from "../../services/access/runtime/composition.js";
import { NativeFailure } from "../../services/access/types/native-errors.js";
import type { NativeAuthority } from "../../services/access/types/native.js";
import {
  createConnectionsService,
  type ConnectionsService,
} from "../../services/connections/composition.js";
import { registerConnectionsHttp } from "../../services/connections/runtime/http.js";
import { openConnectorCatalog } from "../../services/connections/providers/catalog/provider.js";
import { CommonError } from "../../services/connections/shared/errors.js";
import { ConnectionError } from "../../services/connections/types/errors.js";
import type { ConnectorProvider } from "../../services/connections/types/provider.js";
import type { CompanionConfiguration } from "./config.js";

/** Process composition owns optional integrations, resources and maintenance lifetime. */
export async function composeCompanion(
  config: CompanionConfiguration,
  adapters: { native?: NativeAuthority; connections?: ConnectorProvider } = {},
) {
  let pool: pg.Pool | undefined;
  const connections: { service: ConnectionsService | null } = { service: null };
  let sweep: Promise<void> | undefined;
  let lastMaintenanceFailure: Date | null = null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const app = await composeAccess(
      config.access,
      async (http, access, native, identity) => {
        if (config.connections) {
          pool = new pg.Pool({
            connectionString: config.access.databaseUrl,
            max: 10,
          });
          const key = await readFile(config.access.encryptionKeyFile);
          const apiKey = (
            await readFile(config.connections.apiKeyFile, "utf8")
          ).trim();
          const catalog = await openConnectorCatalog(
            config.connections.catalogDirectory,
            { verifyDetails: true },
          );
          connections.service = await createConnectionsService({
            pool,
            serverId: identity.serverId,
            key,
            catalog,
            identity: {
              resolveSessionHash: (hash) => access.resolveSessionHash(hash),
              verifyAdministrator: async (hash) => {
                const current = await access.resolveSessionHash(hash);
                if (!current)
                  throw new CommonError(
                    "unauthenticated",
                    "Sign in to continue.",
                  );
                try {
                  const proof = await access.withActingSession(
                    hash,
                    (credential) =>
                      native.verifyAdministrator(
                        {
                          identity: current.user.identity,
                          name: current.user.name,
                          sessionHash: current.hash,
                        },
                        credential,
                      ),
                  );
                  return { userId: current.user.id, agentIds: proof.agentIds };
                } catch (error) {
                  if (
                    error instanceof NativeFailure &&
                    error.code === "access_denied"
                  )
                    throw new CommonError(
                      "forbidden",
                      "Administrator access is required.",
                    );
                  if (error instanceof NativeFailure)
                    throw new ConnectionError(
                      "connector_native_unavailable",
                      "Administrator access could not be checked. Try again.",
                    );
                  throw error;
                }
              },
            },
            configuration: {
              projectId: config.connections.projectId,
              apiKey,
              callbackUrl: `${config.access.origin}/_clawscarf/connections/verify`,
              publicOrigin: config.access.origin,
            },
            ...(adapters.connections ? { provider: adapters.connections } : {}),
          });
        }
        await registerConnectionsHttp(http, {
          service: connections.service,
          access,
          origin: config.access.origin,
          webRoot: fileURLToPath(
            new URL("../../services/connections/dist/web", import.meta.url),
          ),
        });
      },
      {
        ...(adapters.native ? { native: adapters.native } : {}),
        ...(config.connections &&
        config.access.managementTls &&
        config.access.runtime.managementOrigin
          ? {
              companionApi: {
                origin: config.access.runtime.managementOrigin,
                pathPrefix: "/_clawscarf/connections/v1/connector-runtime/",
              },
            }
          : {}),
        applicationReturnPath: (path) =>
          config.connections !== null &&
          config.connections !== undefined &&
          /^\/_clawscarf\/connections\/(?:return\/[a-zA-Z0-9-]+)?$/.test(path),
        navigationLinks: config.connections
          ? [{ label: "Connections", href: "/_clawscarf/connections/" }]
          : [],
      },
    );
    if (connections.service) {
      const active = connections.service;
      const maintain = () => {
        if (sweep || controller.signal.aborted) return;
        sweep = active.maintenance
          .sweep(controller.signal)
          .then(() => {
            lastMaintenanceFailure = null;
          })
          .catch(() => {
            lastMaintenanceFailure = new Date();
            console.error(
              "Connections maintenance failed; cleanup will be retried.",
            );
          })
          .finally(() => {
            sweep = undefined;
          });
      };
      timer = setInterval(maintain, 60_000);
      timer.unref();
      maintain();
    }
    return {
      ...app,
      connections: connections.service,
      maintenanceFailure: () => lastMaintenanceFailure,
      async close() {
        if (timer) clearInterval(timer);
        controller.abort();
        await sweep;
        try {
          await app.close();
        } finally {
          await pool?.end();
        }
      },
    };
  } catch (error) {
    if (timer) clearInterval(timer);
    controller.abort();
    await sweep;
    await pool?.end();
    throw error;
  }
}
