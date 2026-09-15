import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { prepareLocal } from "./local/prepare.js";
import { LocalSetupError } from "./local/process.js";
import { LocalDatabaseError } from "./local/database.js";
import { launchLocal } from "./local/launch.js";
import { localLoginCode } from "./local/login.js";
import { readState } from "./local/state.js";
import { resolve } from "node:path";
import { upgradeLocal } from "./local/upgrade.js";
import { operateConnectionsRuntime } from "./local/connections-runtime.js";
const command = new Command("clawscarf-local");
const connections = command
  .command("connections")
  .description(
    "Observe or explicitly configure the stopped native Connections integration",
  );
connections
  .command("observe")
  .requiredOption(
    "--directory <path>",
    "Stopped private installation directory; start only its controller",
  )
  .action(async (options: { directory: string }) => {
    process.stdout.write(
      JSON.stringify(
        await operateConnectionsRuntime(options.directory, { kind: "observe" }),
      ) + "\n",
    );
  });
connections
  .command("configure")
  .requiredOption(
    "--directory <path>",
    "Stopped private installation directory; start only its controller",
  )
  .requiredOption(
    "--credential-file <path>",
    "Private file containing the scoped broker token",
  )
  .requiredOption(
    "--yes",
    "Replace only the Connections endpoint and credential; preserve native disablement and other settings",
  )
  .action(async (options: { directory: string; credentialFile: string }) => {
    process.stdout.write(
      JSON.stringify(
        await operateConnectionsRuntime(options.directory, {
          kind: "configure",
          credentialFile: options.credentialFile,
        }),
      ) + "\n",
    );
  });
command
  .command("upgrade")
  .requiredOption(
    "--directory <path>",
    "Stopped private installation directory; start only its controller",
  )
  .requiredOption(
    "--runtime-image <digest>",
    "Exact replacement image with ClawScarf startup-gate support",
  )
  .requiredOption(
    "--python <path>",
    "Python with pinned operator SDK dependencies installed",
  )
  .requiredOption(
    "--yes",
    "Replace stopped compute; retain data without promising rollback",
  )
  .action(
    async (options: {
      directory: string;
      runtimeImage: string;
      python: string;
    }) => {
      await upgradeLocal(
        options.directory,
        options.runtimeImage,
        options.python,
        (message) => process.stdout.write(message + "\n"),
      );
    },
  );
command
  .command("prepare")
  .requiredOption("--directory <path>", "Private installation directory")
  .requiredOption(
    "--config <path>",
    "Installation inputs; credentials are referenced through private files",
  )
  .action(async (options: { directory: string; config: string }) => {
    await prepareLocal(
      options.directory,
      JSON.parse(await readFile(options.config, "utf8")),
    );
    process.stdout.write(
      "Installation configuration, database and native volume prepared. Runtime launch is not part of this command.\n",
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
