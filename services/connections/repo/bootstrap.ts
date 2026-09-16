import { CommonError } from "../shared/errors.js";
import { transaction, type Database } from "./database.js";
import { PostgresConnectionCredentialStore } from "./credential-store.js";
import type { ConnectionCredential } from "../types/model.js";

/** Offline installation bootstrap. Never rotates or reactivates an existing credential. */
export async function initializeConnectionCredential(
  database: Database,
  credential: ConnectionCredential,
) {
  await transaction(database, async (client) => {
    await client.query(
      "LOCK TABLE connection_credentials IN SHARE ROW EXCLUSIVE MODE",
    );
    const store = new PostgresConnectionCredentialStore(client);
    const existing = await store.get(credential, credential.credentialId);
    if (existing) {
      if (
        existing.credentialId !== credential.credentialId ||
        existing.hash !== credential.hash
      )
        throw new CommonError(
          "revision_conflict",
          "Connections credentials already exist; bootstrap cannot replace them.",
        );
      // A revoked initial credential must stay revoked, including on repeated prepare.
      return;
    }
    if (await store.latest(credential))
      throw new CommonError(
        "revision_conflict",
        "Connections credentials already exist; bootstrap cannot replace them.",
      );
    await store.save(credential);
  });
}
