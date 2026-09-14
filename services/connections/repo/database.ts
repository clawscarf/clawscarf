import pg from "pg";
export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  pool.on("error", () => {
    console.error(
      JSON.stringify({ component: "postgres", event: "idle_connection_error" }),
    );
  });
  return pool;
}
export type Database = pg.Pool;
export type Transaction = pg.PoolClient;

/** Queries that promise one row must not silently substitute an empty/default result. */
export function oneRow<Row extends pg.QueryResultRow>(
  result: pg.QueryResult<Row>,
): Row {
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row)
    throw Error("Expected exactly one database row.");
  return row;
}
export async function transaction<T>(
  pool: Database,
  work: (client: Transaction) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  const onConnectionError = () => {
    discard = true;
  };
  client.on("error", onConnectionError);
  try {
    await client.query("BEGIN");
    await client.query(
      "SET LOCAL search_path TO clawscarf_connections, pg_catalog",
    );
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.removeListener("error", onConnectionError);
    client.release(discard);
  }
}
