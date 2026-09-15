import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { prepareLocal } from "./local/prepare.js";
import { LocalSetupError } from "./local/process.js";
import { LocalDatabaseError } from "./local/database.js";
import { launchLocal } from "./local/launch.js";
import { localLoginCode } from "./local/login.js";
import { readState } from "./local/state.js";
import { resolve } from "node:path";
const command = new Command("clawscarf-local");
command
  .command("prepare")
  .requiredOption("--directory <path>", "Private installation directory")
  .requiredOption(
    "--config <path>",
    "Local setup inputs; no credentials required",
  )
  .action(async (options: { directory: string; config: string }) => {
    await prepareLocal(
      options.directory,
      JSON.parse(await readFile(options.config, "utf8")),
    );
    process.stdout.write(
      "Local configuration, database and native volume prepared. Runtime launch is not part of this command.\n",
    );
  });
command
  .command("start")
  .requiredOption(
    "--directory <path>",
    "Prepared private installation directory",
  )
  .action(async (options: { directory: string }) => {
    await launchLocal(options.directory, (message) =>
      process.stdout.write(message + "\n"),
    );
  });
command
  .command("login")
  .requiredOption(
    "--directory <path>",
    "Running private installation directory",
  )
  .action(async (options: { directory: string }) => {
    const directory = resolve(options.directory);
    await readState(directory);
    const login = await localLoginCode(directory);
    process.stdout.write(
      `Open ${login.url}\nOne-use code (expires in five minutes): ${login.code}\n`,
    );
  });
try {
  await command.parseAsync();
} catch (error) {
  const detail =
    error instanceof LocalSetupError || error instanceof LocalDatabaseError
      ? error.message
      : "Local setup did not complete. Check the private configuration and resource ownership before resuming.";
  process.stderr.write(detail + "\n");
  process.exitCode = 1;
}
