import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isMissingFile,
  privateDirectory,
  readPrivateFile,
} from "./private-files.js";

/** Native trusted-proxy auth supports this credential only for direct local calls. */
export async function gatewayPassword(state: string, create: boolean) {
  await privateDirectory(state);
  const path = join(state, "clawscarf-gateway-password");
  try {
    return await read();
  } catch (error) {
    if (!isMissingFile(error, path)) throw error;
    if (!create) return undefined;
  }
  try {
    await writeFile(path, randomBytes(32).toString("base64url"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
  }
  return read();

  async function read() {
    const password = (await readPrivateFile(path, 43)).toString("utf8");
    if (!/^[A-Za-z0-9_-]{43}$/.test(password))
      throw new Error("Invalid local Gateway credential.");
    return password;
  }
}
