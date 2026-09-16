import { X509Certificate } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  isMissingFile,
  privateDirectory,
  readPrivateFile,
} from "./private-files.js";

const credentialSchema = z.strictObject({
  token: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[\x21-\x7e]+$/u),
});
/** No credential directory means unconfigured; retained partial or unsafe material fails closed. */
export async function loadConnectionsCredential(stateDirectory: string) {
  const directory = join(stateDirectory, "clawscarf-connections");
  try {
    await privateDirectory(directory);
  } catch (error) {
    if (isMissingFile(error, directory)) return undefined;
    throw error;
  }
  await privateDirectory(stateDirectory);
  const credential = credentialSchema.parse(
    JSON.parse(
      (await readPrivateFile(join(directory, "runtime.json"))).toString("utf8"),
    ),
  );
  const caPath = join(directory, "ca.pem");
  let ca: Buffer | undefined;
  try {
    ca = await readPrivateFile(caPath);
    new X509Certificate(ca);
  } catch (error) {
    if (!isMissingFile(error, caPath)) throw error;
  }
  return { token: credential.token, ...(ca ? { ca, caPath } : {}) };
}
