import { oneRow, type Transaction } from "./database.js";
import type {
  ConnectionReturnRecord,
  ConnectionReturnStore,
} from "../types/returns.js";

interface Row {
  id: string;
  cookie_hash: string;
  session_hash: string;
  sealed_session: string;
  expires_at: Date;
}

function view(row: Row): ConnectionReturnRecord {
  return {
    id: row.id,
    cookieHash: row.cookie_hash,
    sessionHash: row.session_hash,
    sealedSession: row.sealed_session,
    expiresAt: row.expires_at.toISOString(),
  };
}

export async function checkConnectionReturnSchema(
  database: Pick<Transaction, "query">,
) {
  await database.query(
    "SELECT id,cookie_hash,session_hash,sealed_session,created_at,expires_at FROM connection_returns LIMIT 0",
  );
  const schema = oneRow(
    await database.query<{ constraints: boolean; index: boolean }>(
      `SELECT
       (SELECT count(*)=6 FROM pg_constraint
         WHERE conrelid='connection_returns'::regclass AND convalidated
           AND conname IN ('connection_returns_pkey','connection_returns_cookie_hash_check',
             'connection_returns_session_hash_check','connection_returns_sealed_session_check',
             'connection_returns_lifetime','connection_returns_cookie_hash_session_hash_key')) AS constraints,
       EXISTS(SELECT 1 FROM pg_index
         WHERE indrelid='connection_returns'::regclass
           AND indexrelid=to_regclass('connection_returns_expiry')
           AND indisvalid AND indisready) AS index`,
    ),
  );
  if (!schema.constraints || !schema.index)
    throw Error("Connection returns require the current database migrations.");
}

export class PostgresConnectionReturnStore implements ConnectionReturnStore {
  constructor(private readonly client: Transaction) {}

  async stage(record: Omit<ConnectionReturnRecord, "expiresAt">) {
    // Serialize this unauthenticated staging pool independently of installation and invitation locks.
    await this.client.query("SELECT pg_advisory_xact_lock(172912004)");
    const { now } = oneRow(
      await this.client.query<{ now: string }>(
        "SELECT clock_timestamp()::text AS now",
      ),
    );
    await this.client.query(
      "DELETE FROM connection_returns WHERE expires_at<=$1::timestamptz",
      [now],
    );
    const previous = (
      await this.client.query<Row>(
        "SELECT id,cookie_hash,session_hash,sealed_session,expires_at FROM connection_returns WHERE cookie_hash=$1 AND session_hash=$2",
        [record.cookieHash, record.sessionHash],
      )
    ).rows[0];
    if (previous) return view(previous);
    const count = oneRow(
      await this.client.query<{ total: number; browser: number }>(
        "SELECT count(*)::int AS total,count(*) FILTER(WHERE cookie_hash=$1)::int AS browser FROM connection_returns",
        [record.cookieHash],
      ),
    );
    if (count.total >= 10_000 || count.browser >= 100) return null;
    return view(
      oneRow(
        await this.client.query<Row>(
          `INSERT INTO connection_returns(id,cookie_hash,session_hash,sealed_session,created_at,expires_at)
           VALUES($1,$2,$3,$4,$5::timestamptz,$5::timestamptz+interval '10 minutes')
           RETURNING id,cookie_hash,session_hash,sealed_session,expires_at`,
          [
            record.id,
            record.cookieHash,
            record.sessionHash,
            record.sealedSession,
            now,
          ],
        ),
      ),
    );
  }

  async get(id: string, cookieHash: string) {
    const row = (
      await this.client.query<Row>(
        "SELECT id,cookie_hash,session_hash,sealed_session,expires_at FROM connection_returns WHERE id=$1 AND cookie_hash=$2 AND expires_at>clock_timestamp()",
        [id, cookieHash],
      )
    ).rows[0];
    return row ? view(row) : null;
  }
}
