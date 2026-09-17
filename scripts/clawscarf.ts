#!/usr/bin/env node
import { ModelConfigurationError } from "../runtime/model-contract.js";
import { ZodError } from "zod";
import { InstallationError } from "./installation/errors.js";
import { LocalSetupError } from "./local/process.js";
import { LocalDatabaseError } from "./local/database.js";
import { installationCommand } from "./installation/command.js";
try {
  await installationCommand().parseAsync();
} catch (error) {
  const known =
    error instanceof InstallationError ||
    error instanceof LocalSetupError ||
    error instanceof LocalDatabaseError ||
    error instanceof ModelConfigurationError;
  process.stderr.write(
    JSON.stringify({
      ...(error instanceof LocalSetupError && error.commandFailure
        ? { command: error.commandFailure }
        : {}),
      code: known
        ? error.code
        : error instanceof ZodError
          ? "invalid_configuration"
          : "operation_failed",
      detail:
        error instanceof ModelConfigurationError
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
              : "Check the configuration, file permissions and local prerequisites. No operation was automatically retried.",
    }) + "\n",
  );
  process.exitCode = 1;
}
