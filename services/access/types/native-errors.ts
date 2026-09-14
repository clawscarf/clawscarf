export type NativeFailureCode =
  | "access_denied"
  | "unavailable"
  | "invalid_response"
  | "revision_conflict"
  | "setup_required"
  | "last_administrator"
  | "outcome_unknown";

export class NativeFailure extends Error {
  constructor(readonly code: NativeFailureCode) {
    super(code);
  }
}
