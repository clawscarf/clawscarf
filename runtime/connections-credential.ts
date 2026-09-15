import { constants } from "node:fs";
import { X509Certificate } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const credentialSchema = z.strictObject({
  token: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[\x21-\x7e]+$/u),
});
const maximumBytes = 1024 * 1024;

async function privateDirectory(path: string) {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o077) !== 0
  )
    throw new Error("Connections credential directory must be private.");
}
async function privateFile(path: string) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await file.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== process.getuid?.() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size > maximumBytes
    )
      throw new Error("Connections credential material must be private.");
    const bytes = await file.readFile();
    if (bytes.length > maximumBytes)
      throw new Error("Connections credential material exceeds its limit.");
    return bytes;
  } finally {
    await file.close();
  }
}
function absent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** No credential directory means unconfigured; retained partial or unsafe material fails closed. */
export async function loadConnectionsCredential(stateDirectory: string) {
  const directory = join(stateDirectory, "clawscarf-connections");
  try {
    await privateDirectory(directory);
  } catch (error) {
    if (absent(error)) return undefined;
    throw error;
  }
  await privateDirectory(stateDirectory);
  const credential = credentialSchema.parse(
    JSON.parse(
      (await privateFile(join(directory, "runtime.json"))).toString("utf8"),
    ),
  );
  const caPath = join(directory, "ca.pem");
  let ca: Buffer | undefined;
  try {
    ca = await privateFile(caPath);
    new X509Certificate(ca);
  } catch (error) {
    if (!absent(error)) throw error;
  }
  return { token: credential.token, ...(ca ? { ca, caPath } : {}) };
}
