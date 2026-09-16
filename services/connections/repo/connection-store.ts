import { oneRow, type Transaction } from "./database.js";
import type { ConnectorServerScope } from "../types/authority.js";
import type { ConnectionRecord, ConnectionCommand } from "../types/model.js";
import type { ConnectionStore } from "../types/ports.js";

interface Row {
  id: string;
  server_id: string;
  connector_id: string;
  name: string;
  grant_policy: ConnectionRecord["grant"];
  state: ConnectionRecord["state"];
  generation: number;
  revision: number;
  active_account_id: string | null;
  failure: ConnectionRecord["failure"];
  created_at: Date;
  updated_at: Date;
}
const view = (r: Row): ConnectionRecord => ({
  id: r.id,
  serverId: r.server_id,
  connectorId: r.connector_id,
  name: r.name,
  grant: r.grant_policy,
  state: r.state,
  generation: r.generation,
  revision: r.revision,
  activeAccountId: r.active_account_id,
  failure: r.failure,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
export class PostgresConnectionStore implements ConnectionStore {
  constructor(private readonly client: Transaction) {}
  async get(scope: ConnectorServerScope, id: string) {
    const row = (
      await this.client.query<Row>(
        "SELECT * FROM connections WHERE server_id=$1 AND id=$2",
        [scope.serverId, id],
      )
    ).rows[0];
    return row ? view(row) : null;
  }
  async list(
    scope: ConnectorServerScope,
    limit: number,
    cursor: string | null,
    includeDisconnected: boolean,
  ) {
    const rows = await this.client.query<Row>(
      "SELECT c.* FROM connections c WHERE server_id=$1 AND ($2::uuid IS NULL OR id>$2) AND ($4 OR state<>'disconnected' OR EXISTS(SELECT 1 FROM connection_accounts a WHERE a.connection_id=c.id AND a.cleanup IN ('pending','running','needs_attention')) OR EXISTS(SELECT 1 FROM connection_setups s WHERE s.connection_id=c.id AND s.state='outcome_unknown')) ORDER BY id LIMIT $3",
      [scope.serverId, cursor, limit + 1, includeDisconnected],
    );
    return {
      items: rows.rows.slice(0, limit).map(view),
      nextCursor:
        rows.rows.length > limit
          ? Buffer.from(rows.rows[limit - 1]!.id).toString("base64url")
          : null,
    };
  }
  async count(scope: ConnectorServerScope) {
    return oneRow(
      await this.client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM connections c WHERE server_id=$1 AND (state<>'disconnected' OR EXISTS(SELECT 1 FROM connection_setups s WHERE s.connection_id=c.id AND s.state IN ('creating','pending','verifying','outcome_unknown')))",
        [scope.serverId],
      ),
    ).count;
  }
  async usable(scope: ConnectorServerScope, agentId: string) {
    const rows = await this.client.query<Row>(
      "SELECT * FROM connections WHERE server_id=$1 AND state='connected' AND (grant_policy->>'mode'='all' OR grant_policy->'agentIds' ? $2) ORDER BY id LIMIT 501",
      [scope.serverId, agentId],
    );
    return rows.rows.map(view);
  }
  async save(r: ConnectionRecord) {
    oneRow(
      await this.client.query<{ id: string }>(
        "INSERT INTO connections(id,server_id,connector_id,name,grant_policy,state,generation,revision,active_account_id,failure,created_at,updated_at)\n      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET name=excluded.name,grant_policy=excluded.grant_policy,state=excluded.state,generation=excluded.generation,revision=excluded.revision,active_account_id=excluded.active_account_id,failure=excluded.failure,updated_at=excluded.updated_at\n      WHERE connections.server_id=excluded.server_id AND connections.connector_id=excluded.connector_id RETURNING id",
        [
          r.id,
          r.serverId,
          r.connectorId,
          r.name,
          JSON.stringify(r.grant),
          r.state,
          r.generation,
          r.revision,
          r.activeAccountId,
          r.failure,
          r.createdAt,
          r.updatedAt,
        ],
      ),
    );
  }
  async command(scope: ConnectorServerScope, actorId: string, key: string) {
    const row = (
      await this.client.query<{ fingerprint: string; resource_id: string }>(
        "SELECT fingerprint,resource_id FROM connection_commands WHERE server_id=$1 AND actor_id=$2 AND key=$3",
        [scope.serverId, actorId, key],
      )
    ).rows[0];
    return row
      ? {
          actorId,
          key,
          fingerprint: row.fingerprint,
          resourceId: row.resource_id,
        }
      : null;
  }
  async saveCommand(scope: ConnectorServerScope, c: ConnectionCommand) {
    await this.client.query(
      "INSERT INTO connection_commands(server_id,actor_id,key,fingerprint,resource_id) VALUES($1,$2,$3,$4,$5)",
      [scope.serverId, c.actorId, c.key, c.fingerprint, c.resourceId],
    );
  }
}
