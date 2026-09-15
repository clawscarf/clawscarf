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
    error instanceof LocalDatabaseError;
  process.stderr.write(
    JSON.stringify({
      code: known
        ? error.code
        : error instanceof ZodError
          ? "invalid_configuration"
          : "operation_failed",
      detail: known
        ? error.message
        : "Check the configuration, file permissions and local prerequisites. No operation was automatically retried.",
    }) + "\n",
  );
  process.exitCode = 1;
}
