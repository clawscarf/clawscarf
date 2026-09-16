import { checkConnectionsSchema } from "./schema.js";
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
import { PostgresConnectionCallbackStore } from "./callback-store.js";
import { PostgresConnectionReturnStore } from "./return-store.js";
import { PostgresCatalogPublicationStore } from "./catalog-publication.js";
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
  checkSchema() {
    return transaction(this.pool, checkConnectionsSchema);
  }
}
