import { oneRow, type Transaction } from "./database.js";

// Readiness checks detect missing integrity constraints as well as missing columns.
// Keep their ownership here; individual stores only read and write domain records.
const requiredConstraints = {
  connection_callback_receipts: [
    "connection_callback_receipts_pkey",
    "connection_callback_receipts_callback_hash_fkey",
    "connection_callback_receipts_project_id_check",
    "connection_callback_receipts_subject_id_check",
    "connection_callback_receipts_provider_account_id_check",
    "connection_callback_receipts_toolkit_check",
  ],
  connection_returns: [
    "connection_returns_pkey",
    "connection_returns_cookie_hash_check",
    "connection_returns_session_hash_check",
    "connection_returns_sealed_session_check",
    "connection_returns_lifetime",
    "connection_returns_cookie_hash_session_hash_key",
  ],
  connection_catalog_publication: [
    "connection_catalog_publication_pkey",
    "connection_catalog_publication_singleton_check",
    "connection_catalog_publication_version_check",
    "connection_catalog_publication_connectors_check",
    "connection_catalog_publication_unpublished",
  ],
  connection_setups: [
    "connection_setups_prepared_auth",
    "connection_setups_preparation_pair",
    "connection_setups_preparation_catalog_version_check",
  ],
  connection_invocations: [
    "connection_invocations_result_retention_check",
    "connection_invocations_result_storage_check",
    "connection_invocations_result_success_check",
  ],
  connection_result_pages: [
    "connection_result_pages_invocation_fkey",
    "connection_result_pages_number_check",
    "connection_result_pages_payload_check",
    "connection_result_pages_pkey",
  ],
};
const requiredIndexes = {
  connection_callback_receipts_account: "connection_callback_receipts",
  connection_returns_expiry: "connection_returns",
  connection_invocations_result_retention: "connection_invocations",
  connections_connector: "connections",
  connection_accounts_catalog: "connection_accounts",
  connection_setups_catalog: "connection_setups",
  connection_invocations_catalog: "connection_invocations",
};

export async function checkConnectionsSchema(
  database: Pick<Transaction, "query">,
) {
  await database.query(`SELECT c.id,s.actor,s.sealed_url,a.provider_account_id,
      s.preparation_dispatched_at,s.preparation_catalog_version,s.prepared_auth,
      i.id,i.completed_at,i.sealed_result,i.sealed_result_manifest,i.result_unavailable,
      p.invocation_id,p.page_number,p.sealed_page,
      cb.hash,cb.user_id,cb.state,cb.connection_id,
      receipt.callback_hash,receipt.project_id,receipt.subject_id,receipt.provider_account_id,receipt.toolkit,
      r.id,r.cookie_hash,r.session_hash,r.sealed_session,r.created_at,r.expires_at,
      publication.singleton,publication.version,publication.connectors
    FROM connections c
    LEFT JOIN connection_setups s ON s.connection_id=c.id
    LEFT JOIN connection_accounts a ON a.id=c.active_account_id
    LEFT JOIN connection_invocations i ON i.connection_id=c.id
    CROSS JOIN connection_result_pages p
    CROSS JOIN connection_callbacks cb
    CROSS JOIN connection_callback_receipts receipt
    CROSS JOIN connection_returns r
    CROSS JOIN connection_catalog_publication publication LIMIT 0`);
  const schema = oneRow(
    await database.query<{
      constraints: boolean;
      indexes: boolean;
      publication: boolean;
    }>(
      `SELECT
      NOT EXISTS (
        SELECT 1 FROM jsonb_each($1::jsonb) expected_table
        CROSS JOIN LATERAL jsonb_array_elements_text(expected_table.value) expected_constraint
        WHERE NOT EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid=to_regclass(expected_table.key)
            AND conname=expected_constraint.value AND convalidated)
      ) AS constraints,
      NOT EXISTS (
        SELECT 1 FROM jsonb_each_text($2::jsonb) expected
        WHERE NOT EXISTS (SELECT 1 FROM pg_index
          WHERE indexrelid=to_regclass(expected.key) AND indrelid=to_regclass(expected.value)
            AND indisvalid AND indisready)
      ) AS indexes,
      (SELECT count(*)=1 FROM connection_catalog_publication WHERE singleton=1) AS publication`,
      [JSON.stringify(requiredConstraints), JSON.stringify(requiredIndexes)],
    ),
  );
  if (!schema.constraints || !schema.indexes || !schema.publication)
    throw Error("Connections requires the current database migrations.");
}
