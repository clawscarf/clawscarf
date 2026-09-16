import { oneRow, type Database } from "./database.js";
import type { ConnectionResultRetentionStore } from "../types/result-retention.js";

export class PostgresConnectionResultRetention implements ConnectionResultRetentionStore {
  constructor(private readonly database: Pick<Database, "query">) {}

  async expire(input: Parameters<ConnectionResultRetentionStore["expire"]>[0]) {
    if (
      !Number.isFinite(input.completedBefore.getTime()) ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    )
      throw Error("Invalid connection result retention batch.");
    const result = oneRow(
      await this.database.query<{ expired: number }>(
        `WITH due AS (
        SELECT id FROM connection_invocations
        WHERE (sealed_result IS NOT NULL OR sealed_result_manifest IS NOT NULL) AND completed_at<=$1
        ORDER BY completed_at,id
        LIMIT $2 FOR UPDATE SKIP LOCKED
      ), cleared AS (
        UPDATE connection_invocations invocation
        SET sealed_result=NULL,sealed_result_manifest=NULL,result_unavailable='expired'
        FROM due WHERE invocation.id=due.id RETURNING invocation.id
      ), removed AS (
        DELETE FROM connection_result_pages page USING cleared
        WHERE page.invocation_id=cleared.id
      )
      SELECT count(*)::integer AS expired FROM cleared`,
        [input.completedBefore, input.limit],
      ),
    );
    return result.expired;
  }
}
