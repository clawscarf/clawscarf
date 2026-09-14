import { oneRow, type Transaction } from "./database.js";
import type { ConnectorServerScope } from "../types/authority.js";
import type { ConnectionCredential } from "../types/model.js";
import type { ConnectionCredentialStore } from "../types/ports.js";
interface Row {
  id: string;
  server_id: string;
  generation: number;
  hash: string;
  state: ConnectionCredential["state"];
}
const view = (r: Row): ConnectionCredential => ({
  credentialId: r.id,
  serverId: r.server_id,
  credentialGeneration: r.generation,
  hash: r.hash,
  state: r.state,
});
export class PostgresConnectionCredentialStore implements ConnectionCredentialStore {
  constructor(private readonly client: Transaction) {}
  async byHash(hash: string) {
    const r = (
      await this.client.query<Row>(
        "SELECT * FROM connection_credentials WHERE hash=$1",
        [hash],
      )
    ).rows[0];
    return r ? view(r) : null;
  }
  async get(scope: ConnectorServerScope, id: string) {
    const r = (
      await this.client.query<Row>(
        "SELECT * FROM connection_credentials WHERE server_id=$1 AND id=$2",
        [scope.serverId, id],
      )
    ).rows[0];
    return r ? view(r) : null;
  }
  async latest(scope: ConnectorServerScope) {
    const r = (
      await this.client.query<Row>(
        "SELECT * FROM connection_credentials WHERE server_id=$1 ORDER BY generation DESC LIMIT 1",
        [scope.serverId],
      )
    ).rows[0];
    return r ? view(r) : null;
  }
  async current(scope: ConnectorServerScope) {
    const r = (
      await this.client.query<Row>(
        "SELECT * FROM connection_credentials WHERE server_id=$1 AND state='active'",
        [scope.serverId],
      )
    ).rows[0];
    return r ? view(r) : null;
  }
  async save(r: ConnectionCredential) {
    oneRow(
      await this.client.query<{ id: string }>(
        `INSERT INTO connection_credentials(id,server_id,generation,hash,state)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(id) DO UPDATE SET state=excluded.state
         WHERE connection_credentials.hash=excluded.hash
           AND connection_credentials.server_id=excluded.server_id
           AND connection_credentials.generation=excluded.generation
           AND (connection_credentials.state=excluded.state
             OR connection_credentials.state='active' AND excluded.state='revoked')
         RETURNING id`,
        [r.credentialId, r.serverId, r.credentialGeneration, r.hash, r.state],
      ),
    );
  }
  async revoke(scope: ConnectorServerScope, exceptId?: string) {
    await this.client.query(
      "UPDATE connection_credentials SET state='revoked' WHERE server_id=$1 AND ($2::uuid IS NULL OR id<>$2)",
      [scope.serverId, exceptId ?? null],
    );
  }
}
