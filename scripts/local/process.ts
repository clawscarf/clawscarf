import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
type LocalSetupErrorCode =
  | "administrator_unverified"
  | "bootstrap_outcome_unknown"
  | "cleanup_failed"
  | "command_failed"
  | "configuration_changed"
  | "incomplete_certificate"
  | "invalid_certificate"
  | "native_unavailable"
  | "platform_unqualified"
  | "private_directory_required"
  | "private_log_required"
  | "process_exited"
  | "runtime_failed"
  | "runtime_identity_changed"
  | "runtime_lookup_incomplete"
  | "runtime_outcome_unknown"
  | "runtime_start_failed"
  | "runtime_stop_pending"
  | "spawn_failed"
  | "startup_failed"
  | "startup_interrupted"
  | "startup_timed_out"
  | "unowned_directory";

export class LocalSetupError extends Error {
  constructor(
    readonly code: LocalSetupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LocalSetupError";
  }
}

/** Keep subprocess diagnostic payloads out of operator errors: they can contain secrets. */
export async function run(
  executable: string,
  args: readonly string[],
  options: { input?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<string> {
  try {
    const child = execute(executable, [...args], {
      timeout: options.timeout ?? 60_000,
      maxBuffer: 4 * 1024 * 1024,
      ...(options.env ? { env: options.env } : {}),
    });
    child.child.stdin?.end(options.input);
    return (await child).stdout;
  } catch {
    throw new LocalSetupError(
      "command_failed",
      `The ${executable.split("/").at(-1) ?? "external"} command did not confirm success. Inspect this installation before retrying.`,
    );
  }
}
