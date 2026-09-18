import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { InstallationError } from "./errors.js";
export function fingerprint(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
export async function readInputFile(
  path: string,
  secret = false,
): Promise<Buffer> {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.size > 8 * 1024 * 1024 ||
      (secret && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
    )
      throw new InstallationError(
        "invalid_configuration",
        "Configuration and release files must be bounded regular files; credentials must be private and owned by you.",
      );
    return await file.readFile();
  } finally {
    await file.close();
  }
}
export async function readJson(path: string): Promise<unknown> {
  const input = await readInputFile(path);
  try {
    return JSON.parse(input.toString("utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new InstallationError(
      "invalid_configuration",
      `Invalid JSON in ${JSON.stringify(path)}.`,
    );
  }
}
