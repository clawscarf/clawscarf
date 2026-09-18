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
    const administrator = {
      issuer: mode.issuer,
      subject: mode.administratorSubject ?? "urn:clawscarf:unclaimed",
      email: mode.administratorEmail ?? "",
      name: mode.administratorEmail ?? "Administrator",
      claimRequired: !mode.administratorSubject,
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
