import { oneRow, type Transaction } from "./database.js";
import type {
  CallbackIdentity,
  CallbackRecord,
  ConnectionCallbackStore,
} from "../types/callbacks.js";

interface Row {
  hash: string;
  user_id: string;
  state: CallbackRecord["state"];
  connection_id: string | null;
  project_id: string | null;
  subject_id: string | null;
  provider_account_id: string | null;
  toolkit: string | null;
}

function view(row: Row): CallbackRecord {
  let identity: CallbackIdentity | null = null;
  if (row.project_id !== null) {
    if (
      row.subject_id === null ||
      row.provider_account_id === null ||
      row.toolkit === null
    )
      throw Error("Incomplete connection callback identity receipt.");
    identity = {
      projectId: row.project_id,
      subjectId: row.subject_id,
      accountId: row.provider_account_id,
      toolkit: row.toolkit,
    };
  }
  return {
    hash: row.hash,
    userId: row.user_id,
    state: row.state,
    connectionId: row.connection_id,
    identity,
  };
}

const columns = `callback.hash,callback.user_id,callback.state,callback.connection_id,
  receipt.project_id,receipt.subject_id,receipt.provider_account_id,receipt.toolkit`;

export async function checkConnectionCallbackSchema(
  database: Pick<Transaction, "query">,
) {
  await database.query(
    `SELECT ${columns},receipt.callback_hash FROM connection_callbacks callback
     CROSS JOIN connection_callback_receipts receipt LIMIT 0`,
  );
  const schema = oneRow(
    await database.query<{ constraints: boolean; index: boolean }>(
      `SELECT
       (SELECT count(*)=6 FROM pg_constraint
         WHERE conrelid='connection_callback_receipts'::regclass AND convalidated
           AND conname IN ('connection_callback_receipts_pkey','connection_callback_receipts_callback_hash_fkey',
             'connection_callback_receipts_project_id_check','connection_callback_receipts_subject_id_check',
             'connection_callback_receipts_provider_account_id_check','connection_callback_receipts_toolkit_check')) AS constraints,
       EXISTS(SELECT 1 FROM pg_index
         WHERE indrelid='connection_callback_receipts'::regclass
           AND indexrelid=to_regclass('connection_callback_receipts_account')
           AND indisvalid AND indisready) AS index`,
    ),
  );
  if (!schema.constraints || !schema.index)
    throw Error(
      "Connection callbacks require the current database migrations.",
    );
}

/** Claims are one-use; confirmed receipts are immutable evidence, not admission grants. */
export class PostgresConnectionCallbackStore implements ConnectionCallbackStore {
  constructor(private readonly client: Transaction) {}

  async get(hash: string, userId: string) {
    const row = (
      await this.client.query<Row>(
        `SELECT ${columns} FROM connection_callbacks callback
       LEFT JOIN connection_callback_receipts receipt ON receipt.callback_hash=callback.hash
       WHERE callback.hash=$1 AND callback.user_id=$2`,
        [hash, userId],
      )
    ).rows[0];
    return row ? view(row) : null;
  }

  async claim(hash: string, userId: string) {
    return (
      (
        await this.client.query(
          "INSERT INTO connection_callbacks(hash,user_id,state) VALUES($1,$2,'verifying') ON CONFLICT(hash) DO NOTHING",
          [hash, userId],
        )
      ).rowCount === 1
    );
  }

  async retain(hash: string, userId: string, identity: CallbackIdentity) {
    await this.client.query(
      `INSERT INTO connection_callback_receipts(callback_hash,project_id,subject_id,provider_account_id,toolkit)
       SELECT hash,$3,$4,$5,$6 FROM connection_callbacks
       WHERE hash=$1 AND user_id=$2 AND state='verifying'
       ON CONFLICT(callback_hash) DO NOTHING`,
      [
        hash,
        userId,
        identity.projectId,
        identity.subjectId,
        identity.accountId,
        identity.toolkit,
      ],
    );
    const retained = await this.get(hash, userId);
    if (
      !retained?.identity ||
      retained.identity.projectId !== identity.projectId ||
      retained.identity.subjectId !== identity.subjectId ||
      retained.identity.accountId !== identity.accountId ||
      retained.identity.toolkit !== identity.toolkit
    )
      throw Error(
        "Connection callback receipt does not match its owned claim.",
      );
  }

  async byAccount(userId: string, projectId: string, accountId: string) {
    const row = (
      await this.client.query<Row>(
        `SELECT ${columns} FROM connection_callbacks callback
       JOIN connection_callback_receipts receipt ON receipt.callback_hash=callback.hash
       WHERE callback.user_id=$1 AND receipt.project_id=$2 AND receipt.provider_account_id=$3
       ORDER BY callback.created_at DESC,callback.hash LIMIT 1`,
        [userId, projectId, accountId],
      )
    ).rows[0];
    return row ? view(row) : null;
  }

  async complete(hash: string, userId: string, connectionId: string) {
    oneRow(
      await this.client.query<{ hash: string }>(
        `UPDATE connection_callbacks callback SET state='complete',connection_id=$3
       WHERE hash=$1 AND user_id=$2
         AND EXISTS(SELECT 1 FROM connection_callback_receipts receipt WHERE receipt.callback_hash=callback.hash)
         AND ((state='verifying' AND connection_id IS NULL) OR (state='complete' AND connection_id=$3))
       RETURNING hash`,
        [hash, userId, connectionId],
      ),
    );
  }
}
