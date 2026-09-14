import { runner } from "node-pg-migrate";
import { fileURLToPath } from "node:url";
const databaseUrl = process.env.CLAWSCARF_MIGRATION_DATABASE_URL;
if (!databaseUrl)
  throw Error(
    "Set CLAWSCARF_MIGRATION_DATABASE_URL for the separate migration command.",
  );
await runner({
  databaseUrl,
  dir: fileURLToPath(new URL("../migrations", import.meta.url)),
  direction: "up",
  migrationsTable: "clawscarf_connections_migrations",
  count: Infinity,
  log: () => undefined,
});
