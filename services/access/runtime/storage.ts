import { readFile } from "node:fs/promises";
import pg from "pg";
import { PostgresAccessStore } from "../repo/postgres.js";
import type { AccessConfiguration } from "./config.js";

/** Storage lifetime also used before any native runtime or web assets exist. */
export async function openAccessStorage(
  config: Pick<
    AccessConfiguration,
    "databaseUrl" | "encryptionKeyFile" | "identity"
  >,
) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  try {
    const mode = config.identity;
    const administrator =
      mode.mode === "local"
        ? {
            issuer: "urn:clawscarf:local",
            subject: "administrator",
            email: "administrator@localhost",
            name: mode.name,
          }
        : {
            issuer: mode.issuer,
            subject: mode.administratorSubject,
            email: mode.administratorEmail,
            name: mode.administratorEmail,
          };
    const repository = new PostgresAccessStore(
      pool,
      await readFile(config.encryptionKeyFile),
      administrator,
    );
    const identity = await repository.initialize();
    return { repository, identity, close: () => pool.end() };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
