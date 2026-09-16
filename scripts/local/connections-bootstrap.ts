import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { z } from "zod";
import { initializeConnectionCredential } from "../../services/connections/repo/bootstrap.js";
import { LocalSetupError } from "./process.js";
import { CommonError } from "../../services/connections/shared/errors.js";
import { ensurePrivateFile } from "./state.js";
import {
  readInitialConnectionToken,
  type InitialConnectionsEndpoint,
} from "./connections.js";

const localCredential = z.strictObject({
  serverId: z.uuid(),
  credentialId: z.uuid(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export async function initialConnectionsCredential(input: {
  directory: string;
  serverId: string;
  endpoint: InitialConnectionsEndpoint;
  database: pg.Pool;
  credentialFile?: string;
}) {
  let token: string;
  if (input.credentialFile) {
    token = await readInitialConnectionToken(input.credentialFile);
  } else {
    const file = join(input.directory, "private/connections-bootstrap.json");
    let value: z.infer<typeof localCredential>;
    try {
      value = localCredential.parse(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      value = {
        serverId: input.serverId,
        credentialId: randomUUID(),
        token: randomBytes(32).toString("base64url"),
      };
      await ensurePrivateFile(file, JSON.stringify(value));
    }
    if (value.serverId !== input.serverId)
      throw new LocalSetupError(
        "configuration_changed",
        "Connections bootstrap identity changed.",
      );
    try {
      await initializeConnectionCredential(input.database, {
        serverId: input.serverId,
        credentialId: value.credentialId,
        credentialGeneration: 1,
        hash: createHash("sha256").update(value.token).digest("hex"),
        state: "active",
      });
    } catch (error) {
      if (error instanceof CommonError)
        throw new LocalSetupError(
          "configuration_changed",
          "Connections already has a different initial credential. Setup will not replace or reactivate it.",
        );
      throw error;
    }
    token = value.token;
  }
  return {
    token: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[\x21-\x7e]+$/u)
      .parse(token),
    ...input.endpoint,
  };
}
