import { oneRow, type Transaction } from "./database.js";
import type { ConnectorServerScope } from "../types/authority.js";
import type { ConnectionAccountRecord } from "../types/model.js";
import type { ConnectionAccountStore } from "../types/ports.js";
interface Row {
  id: string;
  server_id: string;
  connection_id: string;
  setup_id: string;
  project_id: string;
  provider_account_id: string;
  subject_id: string;
  toolkit: string;
  auth_configuration_id: string;
  state: ConnectionAccountRecord["state"];
  cleanup: ConnectionAccountRecord["cleanup"];
  revocation_job_id: string | null;
  failure: ConnectionAccountRecord["failure"];
  next_attempt_at: Date | null;
}
const view = (r: Row): ConnectionAccountRecord => ({
  id: r.id,
  serverId: r.server_id,
  connectionId: r.connection_id,
  setupId: r.setup_id,
  projectId: r.project_id,
  binding: {
    accountId: r.provider_account_id,
    subjectId: r.subject_id,
    toolkit: r.toolkit,
    authConfigurationId: r.auth_configuration_id,
  },
  state: r.state,
  cleanup: r.cleanup,
  revocationJobId: r.revocation_job_id,
  failure: r.failure,
  nextAttemptAt: r.next_attempt_at?.toISOString() ?? null,
});
export class PostgresConnectionAccountStore implements ConnectionAccountStore {
  constructor(private readonly client: Transaction) {}
  async get(scope: ConnectorServerScope, id: string) {
    const r = (
      await this.client.query<Row>(
        "SELECT * FROM connection_accounts WHERE server_id=$1 AND id=$2",
        [scope.serverId, id],
      )
    ).rows[0];
    return r ? view(r) : null;
  }
  async byProvider(projectId: string, accountId: string) {
    const r = (
      await this.client.query<Row>(
        "SELECT * FROM connection_accounts WHERE project_id=$1 AND provider_account_id=$2",
        [projectId, accountId],
      )
    ).rows[0];
    return r ? view(r) : null;
  }
  async forConnection(scope: ConnectorServerScope, id: string) {
    return (
      await this.client.query<Row>(
        "SELECT * FROM connection_accounts WHERE server_id=$1 AND connection_id=$2",
        [scope.serverId, id],
      )
    ).rows.map(view);
  }
  async due(limit: number) {
    return (
      await this.client.query<Row>(
        "SELECT * FROM connection_accounts WHERE cleanup IN ('pending','running') AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at LIMIT $1",
        [limit],
      )
    ).rows.map(view);
  }
  async save(r: ConnectionAccountRecord) {
    oneRow(
      await this.client.query<{ id: string }>(
        "INSERT INTO connection_accounts(id,server_id,connection_id,setup_id,project_id,provider_account_id,subject_id,toolkit,auth_configuration_id,state,cleanup,revocation_job_id,failure,next_attempt_at)\n VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET state=excluded.state,cleanup=excluded.cleanup,revocation_job_id=excluded.revocation_job_id,failure=excluded.failure,next_attempt_at=excluded.next_attempt_at\n WHERE connection_accounts.server_id=excluded.server_id AND connection_accounts.connection_id=excluded.connection_id AND connection_accounts.project_id=excluded.project_id AND connection_accounts.provider_account_id=excluded.provider_account_id RETURNING id",
        [
          r.id,
          r.serverId,
          r.connectionId,
          r.setupId,
          r.projectId,
          r.binding.accountId,
          r.binding.subjectId,
          r.binding.toolkit,
          r.binding.authConfigurationId,
          r.state,
          r.cleanup,
          r.revocationJobId,
          r.failure,
          r.nextAttemptAt,
        ],
      ),
    );
  }
}
