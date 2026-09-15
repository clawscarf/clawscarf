import pg from "pg";
import { runner } from "node-pg-migrate";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const inputSchema = z.strictObject({
  adminUrl: z.string(),
  runtimePassword: z
    .string()
    .min(24)
    .max(1024)
    .refine((v) => !v.includes("\0")),
  ownerId: z.uuid(),
});
export class LocalDatabaseError extends Error {
  constructor(
    readonly code:
      | "invalid_configuration"
      | "ownership_conflict"
      | "runtime_credentials_changed"
      | "database_setup_failed",
  ) {
    super(
      {
        invalid_configuration:
          "Use the isolated local clawscarf database and private setup credentials.",
        ownership_conflict:
          "This database or runtime role is not owned by this local installation.",
        runtime_credentials_changed:
          "The saved runtime credentials do not match this local installation.",
        database_setup_failed:
          "Local database setup failed. Check the local PostgreSQL service and setup configuration.",
      }[code],
    );
  }
}
const quiet = () => undefined;

/** Operator-only initialization. Never call from companion startup. */
export async function initializeLocalDatabase(input: {
  adminUrl: string;
  runtimePassword: string;
  ownerId: string;
}): Promise<{ runtimeUrl: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new LocalDatabaseError("invalid_configuration");
  let url: URL;
  try {
    url = new URL(input.adminUrl);
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
  } catch {
    throw new LocalDatabaseError("invalid_configuration");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/clawscarf" ||
    !url.username ||
    !url.password ||
    url.search ||
    url.hash ||
    decodeURIComponent(url.username) === "clawscarf_runtime"
  )
    throw new LocalDatabaseError("invalid_configuration");
  const runtimeUrl = new URL(url);
  runtimeUrl.username = "clawscarf_runtime";
  runtimeUrl.password = encodeURIComponent(input.runtimePassword);
  const client = new pg.Client({ connectionString: url.toString() });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query("SELECT pg_advisory_lock(17893240, 1)");
    const facts = await client.query<{
      owned: boolean;
      marker: string | null;
      role_exists: boolean;
    }>(`SELECT
      (SELECT datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user) FROM pg_database WHERE datname = current_database()) AS owned,
      to_regnamespace('clawscarf_operator')::text AS marker,
      EXISTS(SELECT FROM pg_roles WHERE rolname = 'clawscarf_runtime') AS role_exists`);
    const fact = facts.rows[0];
    if (!fact?.owned) throw new LocalDatabaseError("ownership_conflict");
    if (!fact.marker) {
      const objects = await client.query<{ dirty: boolean }>(`SELECT
        EXISTS(SELECT FROM pg_namespace WHERE nspname NOT IN ('public', 'information_schema') AND nspname !~ '^pg_')
        OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public')
        OR EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')
        OR EXISTS(SELECT FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public')
        OR EXISTS(SELECT FROM pg_extension WHERE extname != 'plpgsql') AS dirty`);
      if (fact.role_exists || objects.rows[0]?.dirty !== false)
        throw new LocalDatabaseError("ownership_conflict");
      await client.query("BEGIN");
      try {
        await client.query("CREATE SCHEMA clawscarf_operator");
        await client.query(
          "REVOKE ALL ON SCHEMA clawscarf_operator FROM PUBLIC",
        );
        await client.query(
          "CREATE TABLE clawscarf_operator.installation (singleton boolean PRIMARY KEY CHECK(singleton), owner_id uuid NOT NULL)",
        );
        await client.query(
          "INSERT INTO clawscarf_operator.installation VALUES (true, $1)",
          [input.ownerId],
        );
        const statement = await client.query<{ sql: string }>(
          "SELECT format('CREATE ROLE clawscarf_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text) AS sql",
          [input.runtimePassword],
        );
        const sql = statement.rows[0]?.sql;
        if (!sql) throw new LocalDatabaseError("database_setup_failed");
        await client.query(sql);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } else {
      const marker = await client.query<{
        owner_id: string;
        operator_owned: boolean;
      }>(`SELECT owner_id,
        (SELECT nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) FROM pg_namespace WHERE nspname = 'clawscarf_operator')
        AND (SELECT relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) FROM pg_class WHERE oid = 'clawscarf_operator.installation'::regclass) AS operator_owned
        FROM clawscarf_operator.installation WHERE singleton`);
      if (
        marker.rowCount !== 1 ||
        marker.rows[0]?.owner_id !== input.ownerId ||
        !marker.rows[0].operator_owned ||
        !fact.role_exists
      )
        throw new LocalDatabaseError("ownership_conflict");
      const runtime = new pg.Client({
        connectionString: runtimeUrl.toString(),
      });
      try {
        await runtime.connect();
        await runtime.query("SELECT 1");
      } catch {
        throw new LocalDatabaseError("runtime_credentials_changed");
      } finally {
        await runtime.end();
      }
    }
    const authority = await client.query<{
      safe: boolean;
    }>(`SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls)
      AND NOT EXISTS(SELECT FROM pg_auth_members WHERE member = r.oid)
      AND NOT EXISTS(SELECT FROM pg_database WHERE datdba = r.oid)
      AND NOT EXISTS(SELECT FROM pg_namespace WHERE nspowner = r.oid)
      AND NOT EXISTS(SELECT FROM pg_class WHERE relowner = r.oid) AS safe
      FROM pg_roles r WHERE rolname = 'clawscarf_runtime'`);
    if (!authority.rows[0]?.safe)
      throw new LocalDatabaseError("ownership_conflict");
    await runner({
      dbClient: client,
      dir: fileURLToPath(
        new URL("../../services/access/migrations", import.meta.url),
      ),
      direction: "up",
      migrationsTable: "clawscarf_access_migrations",
      count: Infinity,
      logger: { debug: quiet, info: quiet, warn: quiet, error: quiet },
    });
    await client.query("BEGIN");
    try {
      await client.query(
        "REVOKE ALL ON DATABASE clawscarf FROM PUBLIC, clawscarf_runtime",
      );
      await client.query(
        "GRANT CONNECT ON DATABASE clawscarf TO clawscarf_runtime",
      );
      await client.query(
        "REVOKE ALL ON SCHEMA public FROM PUBLIC, clawscarf_runtime",
      );
      await client.query(
        "REVOKE ALL ON SCHEMA clawscarf_operator FROM PUBLIC, clawscarf_runtime",
      );
      await client.query(
        "REVOKE ALL ON SCHEMA clawscarf_access FROM PUBLIC, clawscarf_runtime",
      );
      await client.query(
        "GRANT USAGE ON SCHEMA clawscarf_access TO clawscarf_runtime",
      );
      await client.query(
        "REVOKE ALL ON ALL TABLES IN SCHEMA clawscarf_access FROM PUBLIC, clawscarf_runtime",
      );
      await client.query(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA clawscarf_access TO clawscarf_runtime",
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return { runtimeUrl: runtimeUrl.toString() };
  } catch (error) {
    if (error instanceof LocalDatabaseError) throw error;
    throw new LocalDatabaseError("database_setup_failed");
  } finally {
    if (connected) await client.end();
  }
}
