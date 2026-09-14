import { transaction, type Database, type Transaction } from "./database.js";
import type {
  ConnectionRepository,
  ConnectionTransaction,
} from "../types/ports.js";
import { PostgresConnectionStore } from "./connection-store.js";
import { PostgresConnectionSetupStore } from "./setup-store.js";
import { PostgresConnectionAccountStore } from "./account-store.js";
import { PostgresConnectionCredentialStore } from "./credential-store.js";
import { PostgresConnectionInvocationStore } from "./invocation-store.js";
import {
  PostgresConnectionCallbackStore,
  checkConnectionCallbackSchema,
} from "./callback-store.js";
import {
  PostgresConnectionReturnStore,
  checkConnectionReturnSchema,
} from "./return-store.js";
import {
  PostgresCatalogPublicationStore,
  checkCatalogPublicationSchema,
} from "./catalog-publication.js";
export class PostgresConnectionRepository implements ConnectionRepository {
  constructor(
    private readonly pool: Database,
    private readonly bindAuthority: (
      client: Transaction,
    ) => Pick<ConnectionTransaction, "authority">,
  ) {}
  transaction<T>(
    work: (store: ConnectionTransaction) => Promise<T>,
  ): Promise<T> {
    return transaction(this.pool, (client) =>
      work({
        ...this.bindAuthority(client),
        connections: new PostgresConnectionStore(client),
        setups: new PostgresConnectionSetupStore(client),
        callbacks: new PostgresConnectionCallbackStore(client),
        returns: new PostgresConnectionReturnStore(client),
        catalogPublication: new PostgresCatalogPublicationStore(client),
        accounts: new PostgresConnectionAccountStore(client),
        credentials: new PostgresConnectionCredentialStore(client),
        invocations: new PostgresConnectionInvocationStore(client),
      }),
    );
  }
  async checkSchema() {
    await transaction(this.pool, async (client) => {
      await client.query(
        "SELECT c.id,s.actor,s.sealed_url,a.provider_account_id,i.sealed_result FROM connections c LEFT JOIN connection_setups s ON s.connection_id=c.id LEFT JOIN connection_accounts a ON a.id=c.active_account_id LEFT JOIN connection_invocations i ON i.connection_id=c.id LIMIT 0",
      );
      await checkConnectionCallbackSchema(client);
      await checkConnectionReturnSchema(client);
      await checkCatalogPublicationSchema(client);
    });
  }
}
