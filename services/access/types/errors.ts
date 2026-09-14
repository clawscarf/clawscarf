export type AccessCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_request"
  | "invalid_authorization"
  | "email_unverified"
  | "csrf_failed"
  | "dependency_unavailable"
  | "rate_limited";
export class AccessError extends Error {
  constructor(
    readonly code: AccessCode,
    message: string,
  ) {
    super(message);
  }
}
