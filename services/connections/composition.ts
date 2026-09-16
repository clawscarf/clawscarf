import { StandaloneConnectionAuthority } from "./repo/authority.js";
import { transaction } from "./repo/database.js";
import { PostgresConnectionResultRetention } from "./repo/result-retention.js";
import { RESULT_RETENTION_MS } from "./types/result-retention.js";
import type { Database } from "./repo/database.js";
import { PostgresConnectionRepository } from "./repo/repository.js";
import { EncryptedConnectionProtection } from "./providers/protection.js";
import { NativeConnectorAdministratorVerifier } from "./providers/authority.js";
import { createComposioProvider } from "./providers/composio/provider.js";
import type { ConnectorIdentity } from "./types/authority.js";
import type { ConnectorCatalog } from "./types/catalog.js";
import type { ConnectorProvider } from "./types/provider.js";
import { ConnectionService } from "./service/connection-service.js";
import { ConnectionSetupService } from "./service/setup-service.js";
import { ConnectionReturnService } from "./service/return-service.js";
import { ConnectionRefreshService } from "./service/refresh-service.js";
import { ConnectionMaintenanceService } from "./service/maintenance-service.js";
import { ConnectorBrokerService } from "./service/broker-service.js";
import { ConnectorCredentialService } from "./service/runtime-auth.js";
import { ConnectionCredentialManagement } from "./service/credentials.js";
import { requirePublishedCatalog } from "./service/catalog-publication.js";

export interface ConnectionsConfiguration {
  projectId: string;
  apiKey: string;
  callbackUrl: string;
  publicOrigin: string;
}

/** Composition supplies native identity; no provider exists in unconfigured mode. */
export async function createConnectionsService(input: {
  pool: Database;
  serverId: string;
  key: Buffer;
  catalog: ConnectorCatalog;
  identity: ConnectorIdentity;
  configuration: ConnectionsConfiguration;
  provider?: ConnectorProvider;
}) {
  const { configuration: config, serverId, catalog, identity } = input;
  if (!config.projectId || !config.apiKey || input.key.length !== 32)
    throw new Error("Invalid Connections configuration.");
  const callback = new URL(config.callbackUrl);
  const origin = new URL(config.publicOrigin);
  if (callback.origin !== origin.origin)
    throw new Error(
      "Connections callback must use the configured public origin.",
    );
  const verifier = new NativeConnectorAdministratorVerifier(identity, serverId);
  const repository = new PostgresConnectionRepository(input.pool, (client) => ({
    authority: new StandaloneConnectionAuthority(client, serverId, identity),
  }));
  await repository.checkSchema();
  await repository.transaction((store) =>
    requirePublishedCatalog(store.catalogPublication, catalog),
  );
  const protection = new EncryptedConnectionProtection(input.key, serverId);
  const provider =
    input.provider ?? createComposioProvider({ apiKey: config.apiKey });
  const cleanup = new ConnectionMaintenanceService(
    repository,
    provider,
    config.projectId,
  );
  const setups = new ConnectionSetupService(
    repository,
    verifier,
    catalog,
    protection,
    provider,
    config.projectId,
    config.callbackUrl,
  );
  return {
    scope: { serverId },
    catalog,
    service: new ConnectionService(repository, verifier, catalog, protection),
    setups,
    returns: new ConnectionReturnService(repository, protection, setups),
    refresh: new ConnectionRefreshService(
      repository,
      verifier,
      protection,
      provider,
      config.projectId,
    ),
    maintenance: {
      sweep: async (signal?: AbortSignal) => {
        await cleanup.sweep(signal);
        if (!signal?.aborted)
          await transaction(input.pool, (client) =>
            new PostgresConnectionResultRetention(client).expire({
              completedBefore: new Date(Date.now() - RESULT_RETENTION_MS),
              limit: 100,
            }),
          );
      },
    },
    broker: new ConnectorBrokerService(
      repository,
      catalog,
      protection,
      provider,
      config.projectId,
      config.publicOrigin,
    ),
    credentials: new ConnectorCredentialService(repository, protection),
    credentialManagement: new ConnectionCredentialManagement(
      repository,
      verifier,
      protection,
    ),
    verifyAdministrator: verifier.verify.bind(verifier),
  };
}
export type ConnectionsService = Awaited<
  ReturnType<typeof createConnectionsService>
>;
