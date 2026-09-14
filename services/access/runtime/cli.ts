import { Command } from "commander";
import { readFile } from "node:fs/promises";
import * as api from "../generated/client/sdk.gen.js";
const command = new Command("clawscarf-access")
  .description("Manage admission to one ClawScarf server.")
  .requiredOption("--origin <url>", "Server origin")
  .requiredOption(
    "--session-file <path>",
    "Private file containing the browser session credential",
  );
async function request() {
  const options = command.opts<{ origin: string; sessionFile: string }>();
  const credential = (await readFile(options.sessionFile, "utf8")).trim();
  const base = {
    baseUrl: options.origin,
    throwOnError: true,
    headers: {
      cookie: `clawscarf_session=${credential}`,
      origin: options.origin,
    },
  } as const;
  const current = (await api.session(base)).data;
  return {
    ...base,
    headers: { ...base.headers, "x-csrf-token": current.csrfToken },
  };
}
command
  .command("people")
  .description("List admitted people")
  .action(async () => {
    process.stdout.write(
      JSON.stringify((await api.listPeople(await request())).data, null, 2) +
        "\n",
    );
  });
command
  .command("prepare")
  .description("Prepare native team access")
  .action(async () => {
    await api.prepareTeam(await request());
  });
command
  .command("enroll")
  .description("Admit a company identity as a member")
  .requiredOption("--subject <id>")
  .requiredOption("--email <address>")
  .requiredOption("--name <name>")
  .action(async (options: { subject: string; email: string; name: string }) => {
    const result = await api.enrollPerson({
      ...(await request()),
      body: options,
    });
    process.stdout.write(JSON.stringify(result.data, null, 2) + "\n");
  });
command
  .command("remove <userId>")
  .description("Revoke a person's access")
  .action(async (userId: string) => {
    await api.removePerson({ ...(await request()), path: { userId } });
  });
try {
  await command.parseAsync();
} catch (error) {
  const detail =
    typeof error === "object" &&
    error !== null &&
    "detail" in error &&
    typeof error.detail === "string"
      ? error.detail
      : "The request could not be completed.";
  process.stderr.write(detail + "\n");
  process.exitCode = 1;
}
