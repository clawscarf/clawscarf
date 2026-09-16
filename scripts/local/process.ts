import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:os";

const execute = promisify(execFile);
type LocalSetupErrorCode =
  | "invalid_team_configuration"
  | "upgrade_pending"
  | "upgrade_refused"
  | "upgrade_outcome_unknown"
  | "runtime_binding_changed"
  | "runtime_binding_unavailable"
  | "administrator_unverified"
  | "bootstrap_outcome_unknown"
  | "browser_unavailable"
  | "cleanup_failed"
  | "command_failed"
  | "configuration_changed"
  | "database_start_failed"
  | "executable_unavailable"
  | "incomplete_certificate"
  | "invalid_certificate"
  | "invalid_model_setup"
  | "model_credential_pending"
  | "invalid_connections_setup"
  | "connections_catalog_blocked"
  | "connections_configuration_pending"
  | "connections_configuration_refused"
  | "connections_configuration_unavailable"
  | "invalid_runtime_policy"
  | "native_unavailable"
  | "network_identity_changed"
  | "network_lookup_incomplete"
  | "network_outcome_unknown"
  | "network_unprepared"
  | "platform_unqualified"
  | "port_check_failed"
  | "port_in_use"
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
    readonly commandFailure?: CommandFailure,
  ) {
    super(message);
    this.name = "LocalSetupError";
  }
}

export type CommandFailure =
  | { reason: "timeout" | "output_limit" | "unavailable" }
  | { reason: "exit"; exitCode: number }
  | { reason: "signal"; signal: string }
  | { reason: "spawn"; systemCode: string };

function commandFailure(error: unknown): CommandFailure {
  if (!(error instanceof Error)) return { reason: "unavailable" };
  const code = "code" in error ? error.code : undefined;
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    return { reason: "output_limit" };
  if ("killed" in error && error.killed === true) return { reason: "timeout" };
  if (typeof code === "number" && Number.isSafeInteger(code))
    return { reason: "exit", exitCode: code };
  if ("signal" in error) {
    for (const signal of Object.keys(constants.signals))
      if (error.signal === signal) return { reason: "signal", signal };
  }
  if (
    typeof code === "string" &&
    [
      "ENOENT",
      "EACCES",
      "ENOEXEC",
      "ENOTDIR",
      "EAGAIN",
      "EMFILE",
      "ENFILE",
    ].includes(code)
  )
    return { reason: "spawn", systemCode: code };
  return { reason: "unavailable" };
}

function failureDetail(failure: CommandFailure) {
  switch (failure.reason) {
    case "exit":
      return `exit ${String(failure.exitCode)}`;
    case "signal":
      return failure.signal;
    case "spawn":
      return failure.systemCode;
    default:
      return failure.reason;
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
  } catch (error) {
    const failure = commandFailure(error);
    throw new LocalSetupError(
      "command_failed",
      `An external command did not confirm success (${failureDetail(failure)}). Inspect this installation before retrying.`,
      failure,
    );
  }
}
