import { readFile, open, unlink } from "node:fs/promises";
import { Command } from "commander";
import { createClient as accessClient } from "../access/generated/client/client/index.js";
import { session } from "../access/generated/client/sdk.gen.js";
import { createClient } from "./generated/client/client/index.js";
import {
  rotateConnectionCredential,
  revokeConnectionCredential,
} from "./generated/client/sdk.gen.js";

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
  const origin = new URL(options.origin).origin;
  const credential = (await readFile(options.sessionFile, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]+$/.test(credential))
    throw Error("Invalid session file.");
  const headers = { Cookie: `clawscarf_session=${credential}`, Origin: origin };
  const current = await session({
    client: accessClient({ baseUrl: origin, headers }),
    throwOnError: true,
  });
  return createClient({
    baseUrl: origin,
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
      });
      await file.writeFile(result.data.token + "\n");
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
  });
  process.stdout.write("Connection plugin access revoked.\n");
});
await program.parseAsync();
