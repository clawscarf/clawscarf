export type InstallationErrorCode =
  | "invalid_configuration"
  | "unsupported_platform"
  | "release_mismatch"
  | "stale_plan"
  | "change_unsupported"
  | "not_running"
  | "operation_busy"
  | "unavailable";
export class InstallationError extends Error {
  constructor(
    readonly code: InstallationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InstallationError";
  }
}
