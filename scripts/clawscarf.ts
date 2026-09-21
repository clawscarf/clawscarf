#!/usr/bin/env node
import { OperatorError } from "./errors.js";
import { ModelConfigurationError } from "../runtime/model-contract.js";
import { CommanderError } from "commander";
import { ZodError } from "zod";
import { InstallationError } from "./installation/errors.js";
import { LocalSetupError } from "./deployment/process.js";
import { LocalDatabaseError } from "./deployment/database.js";
import { InstallerCancelled } from "./installation/installer/prompts.js";
import { installationCommand } from "./installation/command.js";
import { CliTelemetry } from "./telemetry.js";
const telemetry = new CliTelemetry();
const program = installationCommand(telemetry);
program.hook("preAction", async (_program, command) =>
  telemetry.start(command),
);
let failureCode: string | undefined;
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
    error instanceof OperatorError ||
    error instanceof InstallationError ||
    error instanceof LocalSetupError ||
    error instanceof LocalDatabaseError ||
    error instanceof ModelConfigurationError;
  const remote =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "detail" in error &&
    typeof error.detail === "string"
      ? { code: error.code, detail: error.detail }
      : null;
  const fileFailure =
    error instanceof Error &&
    "code" in error &&
    "path" in error &&
    typeof error.path === "string" &&
    typeof error.code === "string" &&
    [
      "ENOENT",
      "ENOTDIR",
      "EACCES",
      "EPERM",
      "EEXIST",
      "ELOOP",
      "ENOSPC",
    ].includes(error.code)
      ? {
          code: error.code,
          detail: `File operation failed (${error.code}): ${JSON.stringify(error.path)}. Check the path, permissions and available disk space.`,
        }
      : undefined;
  const failure = {
    ...(error instanceof LocalSetupError && error.commandFailure
      ? { command: error.commandFailure }
      : {}),
    code:
      fileFailure?.code ??
      remote?.code ??
      (error instanceof InstallerCancelled
        ? "cancelled"
        : known
          ? error.code
          : error instanceof ZodError
            ? "invalid_configuration"
            : error instanceof CommanderError
              ? "invalid_arguments"
              : "operation_failed"),
    detail:
      fileFailure?.detail ??
      remote?.detail ??
      (error instanceof InstallerCancelled
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
                : "Check the configuration, file permissions and local prerequisites. No operation was automatically retried."),
  };
  failureCode = failure.code;
  process.stderr.write(
    (program.opts<{ json?: boolean }>().json
      ? JSON.stringify(failure)
      : `Error: ${failure.detail}`) + "\n",
  );
  process.exitCode = error instanceof InstallerCancelled ? 130 : 1;
} finally {
  await telemetry.finish(process.exitCode, failureCode);
}
