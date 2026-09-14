import { oneRow, type Transaction } from "./database.js";
import type { ConnectorServerScope } from "../types/authority.js";
import type { ConnectionInvocationRecord } from "../types/model.js";
import type { ConnectionInvocationStore } from "../types/ports.js";
interface Row {
  id: string;
  server_id: string;
  connection_id: string;
  generation: number;
  credential_id: string;
  credential_generation: number;
  account_id: string;
  agent_id: string;
  correlation: string;
  fingerprint: string;
  action_id: string;
  version: string;
  state: ConnectionInvocationRecord["state"];
  created_at: Date;
  completed_at: Date | null;
  failure: ConnectionInvocationRecord["failure"];
  sealed_result: string | null;
  sealed_result_manifest: string | null;
  result_unavailable: ConnectionInvocationRecord["resultUnavailable"];
}
const view = (r: Row): ConnectionInvocationRecord => ({
  id: r.id,
  serverId: r.server_id,
  connectionId: r.connection_id,
  generation: r.generation,
  credentialId: r.credential_id,
  credentialGeneration: r.credential_generation,
  accountId: r.account_id,
  agentId: r.agent_id,
  correlation: r.correlation,
  fingerprint: r.fingerprint,
  actionId: r.action_id,
  version: r.version,
  state: r.state,
  createdAt: r.created_at.toISOString(),
  completedAt: r.completed_at?.toISOString() ?? null,
  failure: r.failure,
  sealedResult: r.sealed_result,
  sealedResultManifest: r.sealed_result_manifest,
  resultUnavailable: r.result_unavailable,
});
export class PostgresConnectionInvocationStore implements ConnectionInvocationStore {
  constructor(private readonly client: Transaction) {}
  async get(scope: ConnectorServerScope, id: string) {
    const r = (
      await this.client.query<Row>(
        "SELECT * FROM connection_invocations WHERE server_id=$1 AND id=$2",
        [scope.serverId, id],
      )
    ).rows[0];
    return r ? view(r) : null;
  }
  async byCorrelation(scope: ConnectorServerScope, correlation: string) {
    const r = (
      await this.client.query<Row>(
        "SELECT * FROM connection_invocations WHERE server_id=$1 AND correlation=$2",
        [scope.serverId, correlation],
      )
    ).rows[0];
    return r ? view(r) : null;
  }
  async resultPage(
    scope: ConnectorServerScope,
    id: string,
    pageNumber: number,
  ) {
    if (
      !Number.isSafeInteger(pageNumber) ||
      pageNumber < 0 ||
      pageNumber >= 1025
    )
      throw Error("Invalid connection result page number.");
    const row = (
      await this.client.query<{ sealed_page: string }>(
        "SELECT page.sealed_page FROM connection_result_pages page\n         JOIN connection_invocations invocation ON invocation.id=page.invocation_id\n         WHERE invocation.server_id=$1\n           AND invocation.id=$2 AND page.page_number=$3",
        [scope.serverId, id, pageNumber],
      )
    ).rows[0];
    return row?.sealed_page ?? null;
  }
  async save(r: ConnectionInvocationRecord, pages: readonly string[] = []) {
    if (
      (r.sealedResultManifest !== null) !== pages.length > 0 ||
      pages.length > 1025 ||
      pages.some((page) => !page || Buffer.byteLength(page) > 64 * 1024)
    )
      throw Error("Invalid connection result page set.");
    oneRow(
      await this.client.query<{ id: string }>(
        "INSERT INTO connection_invocations(id,server_id,connection_id,generation,credential_id,credential_generation,account_id,agent_id,correlation,fingerprint,action_id,version,state,created_at,completed_at,failure,sealed_result,result_unavailable,sealed_result_manifest)\n VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT(id) DO UPDATE SET state=excluded.state,completed_at=excluded.completed_at,failure=excluded.failure,sealed_result=excluded.sealed_result,result_unavailable=excluded.result_unavailable,sealed_result_manifest=excluded.sealed_result_manifest\n WHERE connection_invocations.server_id=excluded.server_id AND connection_invocations.fingerprint=excluded.fingerprint AND connection_invocations.state IN ('dispatching','outcome_unknown') RETURNING id",
        [
          r.id,
          r.serverId,
          r.connectionId,
          r.generation,
          r.credentialId,
          r.credentialGeneration,
          r.accountId,
          r.agentId,
          r.correlation,
          r.fingerprint,
          r.actionId,
          r.version,
          r.state,
          r.createdAt,
          r.completedAt,
          r.failure,
          r.sealedResult,
          r.resultUnavailable,
          r.sealedResultManifest,
        ],
      ),
    );
    if (pages.length)
      await this.client.query(
        `INSERT INTO connection_result_pages(invocation_id,page_number,sealed_page)
         SELECT $1,ordinality-1,page FROM unnest($2::text[]) WITH ORDINALITY AS pages(page,ordinality)`,
        [r.id, pages],
      );
  }
  async expireDispatches() {
    await this.client.query(
      "UPDATE connection_invocations SET state='outcome_unknown',completed_at=clock_timestamp(),result_unavailable='outcome_unknown' WHERE state='dispatching' AND created_at<clock_timestamp()-interval '2 minutes'",
    );
  }
}
