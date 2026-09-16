import { open, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { Command } from "commander";
import { session } from "../access/generated/sdk.gen.js";
import { createClient } from "../../generated/http/client/index.js";
import {
  rotateConnectionCredential,
  revokeConnectionCredential,
} from "./generated/sdk.gen.js";

const program = new Command("connections-credential")
  .description(
    "Manage the plugin credential as a currently signed-in native administrator.",
  )
  .requiredOption("--origin <url>")
  .requiredOption(
    "--session-file <path>",
    "file containing the current ClawScarf session cookie value",
  );
async function authenticatedClient() {
  const options = program.opts<{ origin: string; sessionFile: string }>();
  const url = new URL(options.origin);
  if (
    url.origin !== options.origin ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw Error("Use an exact HTTPS or loopback HTTP origin.");
  const origin = url.origin;
  const file = await open(
    options.sessionFile,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let credential: string;
  try {
    const metadata = await file.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== process.getuid?.() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size > 4096
    )
      throw Error("Use a private session file.");
    const bytes = await file.readFile();
    if (bytes.length > 4096) throw Error("Use a private session file.");
    credential = bytes.toString("utf8").trim();
  } finally {
    await file.close();
  }
  if (!/^[A-Za-z0-9_-]+$/.test(credential))
    throw Error("Invalid session file.");
  const headers = { Cookie: `clawscarf_session=${credential}`, Origin: origin };
  const current = await session({
    client: createClient({ baseUrl: origin, headers, redirect: "error" }),
    throwOnError: true,
    signal: AbortSignal.timeout(10000),
  });
  return createClient({
    baseUrl: origin,
    redirect: "error",
    headers: { ...headers, "X-CSRF-Token": current.data.csrfToken },
  });
}
program
  .command("rotate")
  .requiredOption("--output <path>", "new private token file; must not exist")
  .action(async (options: { output: string }) => {
    const client = await authenticatedClient();
    const file = await open(options.output, "wx", 0o600);
    try {
      const result = await rotateConnectionCredential({
        client,
        throwOnError: true,
        signal: AbortSignal.timeout(30000),
      });
      await file.writeFile(result.data.token + "\n");
      await file.sync();
      process.stdout.write(
        JSON.stringify({
          credentialId: result.data.credentialId,
          generation: result.data.generation,
        }) + "\n",
      );
    } catch (error) {
      await unlink(options.output);
      throw error;
    } finally {
      await file.close();
    }
  });
program.command("revoke").action(async () => {
  await revokeConnectionCredential({
    client: await authenticatedClient(),
    throwOnError: true,
    signal: AbortSignal.timeout(30000),
  });
  process.stdout.write("Connection plugin access revoked.\n");
});
try {
  await program.parseAsync();
} catch {
  process.stderr.write(
    "Credential management did not confirm completion. Check the origin and private administrator session. Do not automatically retry a rotation; an interrupted request may already have revoked the previous token.\n",
  );
  process.exitCode = 1;
}
