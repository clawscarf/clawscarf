import { oneRow, type Database } from "./database.js";
import type { ConnectionResultRetentionStore } from "../types/result-retention.js";

export class PostgresConnectionResultRetention implements ConnectionResultRetentionStore {
  constructor(private readonly database: Pick<Database, "query">) {}

  async checkSchema() {
    await this.database.query(
      `SELECT invocation.id,invocation.completed_at,invocation.sealed_result,
         invocation.sealed_result_manifest,invocation.result_unavailable,
         page.invocation_id,page.page_number,page.sealed_page
       FROM connection_invocations invocation CROSS JOIN connection_result_pages page LIMIT 0`,
    );
    const schema = oneRow(
      await this.database.query<{
        constraint: boolean;
        pages: boolean;
        index: boolean;
      }>(
        `SELECT
          (SELECT count(*)=3 FROM pg_constraint
            WHERE conrelid='connection_invocations'::regclass
              AND conname IN ('connection_invocations_result_retention_check',
                'connection_invocations_result_storage_check','connection_invocations_result_success_check')
              AND convalidated) AS constraint,
          (SELECT count(*)=4 FROM pg_constraint
            WHERE conrelid='connection_result_pages'::regclass
              AND conname IN ('connection_result_pages_invocation_fkey',
                'connection_result_pages_number_check','connection_result_pages_payload_check',
                'connection_result_pages_pkey') AND convalidated) AS pages,
          EXISTS(SELECT 1 FROM pg_index
            WHERE indrelid='connection_invocations'::regclass
              AND indexrelid=to_regclass('connection_invocations_result_retention')
              AND indisvalid AND indisready) AS index`,
      ),
    );
    if (!schema.constraint || !schema.pages || !schema.index)
      throw Error(
        "Connection result retention requires the current database migrations.",
      );
  }

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
