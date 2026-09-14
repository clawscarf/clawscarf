import { oneRow, type Transaction } from "./database.js";
import type { ConnectorServerScope } from "../types/authority.js";
import type { ConnectionSetupRecord } from "../types/model.js";
import type { ConnectionSetupStore } from "../types/ports.js";
interface Row {
  id: string;
  server_id: string;
  connection_id: string;
  initiator_id: string;
  actor: ConnectionSetupRecord["actor"];
  session_hash: string;
  subject_id: string;
  project_id: string;
  kind: ConnectionSetupRecord["kind"];
  state: ConnectionSetupRecord["state"];
  account_id: string | null;
  sealed_url: string | null;
  allocation_dispatched_at: Date | null;
  preparation_dispatched_at: Date | null;
  preparation_catalog_version: string | null;
  prepared_auth: ConnectionSetupRecord["preparedAuth"];
  created_at: Date;
  expires_at: Date;
  completed_at: Date | null;
  failure: ConnectionSetupRecord["failure"];
}
const view = (r: Row): ConnectionSetupRecord => ({
  id: r.id,
  serverId: r.server_id,
  connectionId: r.connection_id,
  initiatorId: r.initiator_id,
  actor: r.actor,
  sessionHash: r.session_hash,
  subjectId: r.subject_id,
  projectId: r.project_id,
  kind: r.kind,
  state: r.state,
  accountId: r.account_id,
  sealedUrl: r.sealed_url,
  allocationDispatchedAt: r.allocation_dispatched_at?.toISOString() ?? null,
  preparationDispatchedAt: r.preparation_dispatched_at?.toISOString() ?? null,
  preparationCatalogVersion: r.preparation_catalog_version,
  preparedAuth: r.prepared_auth,
  createdAt: r.created_at.toISOString(),
  expiresAt: r.expires_at.toISOString(),
  completedAt: r.completed_at?.toISOString() ?? null,
  failure: r.failure,
});
export class PostgresConnectionSetupStore implements ConnectionSetupStore {
  constructor(private readonly client: Transaction) {}
  async byId(id: string) {
    const r = (
      await this.client.query<Row>(
        "SELECT * FROM connection_setups WHERE id=$1",
        [id],
      )
    ).rows[0];
    return r ? view(r) : null;
  }
  async get(scope: ConnectorServerScope, id: string) {
    const r = (
      await this.client.query<Row>(
        "SELECT * FROM connection_setups WHERE server_id=$1 AND id=$2",
        [scope.serverId, id],
      )
    ).rows[0];
    return r ? view(r) : null;
  }
  async latest(scope: ConnectorServerScope, id: string) {
    const r = (
      await this.client.query<Row>(
        "SELECT * FROM connection_setups WHERE server_id=$1 AND connection_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
        [scope.serverId, id],
      )
    ).rows[0];
    return r ? view(r) : null;
  }
  async pendingForUser(userId: string, projectId: string) {
    return (
      await this.client.query<Row>(
        "SELECT * FROM connection_setups WHERE initiator_id=$1 AND project_id=$2 AND state IN ('pending','verifying') AND expires_at>clock_timestamp() ORDER BY created_at LIMIT 101",
        [userId, projectId],
      )
    ).rows.map(view);
  }
  async due(limit: number) {
    return (
      await this.client.query<Row>(
        "SELECT * FROM connection_setups WHERE state IN ('creating','pending','verifying') AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT $1",
        [limit],
      )
    ).rows.map(view);
  }
  async save(r: ConnectionSetupRecord) {
    oneRow(
      await this.client.query<{ id: string }>(
        "INSERT INTO connection_setups(id,server_id,connection_id,initiator_id,session_hash,subject_id,project_id,kind,state,account_id,sealed_url,created_at,expires_at,completed_at,failure,allocation_dispatched_at,actor,preparation_dispatched_at,prepared_auth,preparation_catalog_version)\n VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT(id) DO UPDATE SET allocation_dispatched_at=excluded.allocation_dispatched_at,preparation_dispatched_at=excluded.preparation_dispatched_at,preparation_catalog_version=excluded.preparation_catalog_version,prepared_auth=excluded.prepared_auth,state=excluded.state,account_id=excluded.account_id,sealed_url=excluded.sealed_url,expires_at=excluded.expires_at,completed_at=excluded.completed_at,failure=excluded.failure\n WHERE connection_setups.server_id=excluded.server_id AND connection_setups.connection_id=excluded.connection_id RETURNING id",
        [
          r.id,
          r.serverId,
          r.connectionId,
          r.initiatorId,
          r.sessionHash,
          r.subjectId,
          r.projectId,
          r.kind,
          r.state,
          r.accountId,
          r.sealedUrl,
          r.createdAt,
          r.expiresAt,
          r.completedAt,
          r.failure,
          r.allocationDispatchedAt,
          r.actor,
          r.preparationDispatchedAt,
          r.preparedAuth,
          r.preparationCatalogVersion,
        ],
      ),
    );
  }
}
