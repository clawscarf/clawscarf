#!/usr/bin/env node
import { ModelConfigurationError } from "../runtime/model-contract.js";
import { CommanderError } from "commander";
import { ZodError } from "zod";
import { InstallationError } from "./installation/errors.js";
import { LocalSetupError } from "./local/process.js";
import { LocalDatabaseError } from "./local/database.js";
import { InstallerCancelled } from "./installation/installer/prompts.js";
import { installationCommand } from "./installation/command.js";
const program = installationCommand();
const commands = [program];
for (const command of commands) {
  command.exitOverride().configureOutput({ outputError: () => {} });
  commands.push(...command.commands);
}
try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) process.exit(0);
  const known =
    error instanceof InstallationError ||
    error instanceof LocalSetupError ||
    error instanceof LocalDatabaseError ||
    error instanceof ModelConfigurationError;
  const failure = {
    ...(error instanceof LocalSetupError && error.commandFailure
      ? { command: error.commandFailure }
      : {}),
    code:
      error instanceof InstallerCancelled
        ? "cancelled"
        : known
          ? error.code
          : error instanceof ZodError
            ? "invalid_configuration"
            : error instanceof CommanderError
              ? "invalid_arguments"
              : "operation_failed",
    detail:
      error instanceof InstallerCancelled
        ? "Cancelled. Saved files and any running installation are retained."
        : error instanceof ModelConfigurationError
          ? `Model configuration failed (${error.code}).${error.code === "outcome_unknown" ? " Inspect native settings before retrying an apply." : ""}`
          : known
            ? error.message
            : error instanceof ZodError
              ? "Invalid or missing fields: " +
                [
                  ...new Set(
                    error.issues.map(
                      (issue) => issue.path.join(".") || "configuration",
                    ),
                  ),
                ].join(", ") +
                "."
              : error instanceof CommanderError
                ? error.message
                : "Check the configuration, file permissions and local prerequisites. No operation was automatically retried.",
  };
  process.stderr.write(
    (program.opts<{ json?: boolean }>().json
      ? JSON.stringify(failure)
      : `Error: ${failure.detail}`) + "\n",
  );
  process.exitCode = error instanceof InstallerCancelled ? 130 : 1;
}
