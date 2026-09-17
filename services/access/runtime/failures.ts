import Fastify from "fastify";
import { NativeFailure } from "../types/native-errors.js";
import { AccessError } from "../types/errors.js";

const errorStatus = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_request: 400,
  invalid_authorization: 400,
  administrator_setup_required: 409,
  email_unverified: 403,
  csrf_failed: 403,
  dependency_unavailable: 503,
  rate_limited: 429,
  revision_conflict: 409,
  setup_required: 409,
  last_administrator: 409,
  request_rejected: 409,
  outcome_unknown: 503,
} as const;

export function classifyFailure(error: unknown) {
  const bodyTooLarge =
    error instanceof Fastify.errorCodes.FST_ERR_CTP_BODY_TOO_LARGE;
  const unsupportedType =
    error instanceof Fastify.errorCodes.FST_ERR_CTP_INVALID_MEDIA_TYPE;
  const invalidInput =
    bodyTooLarge ||
    unsupportedType ||
    error instanceof Fastify.errorCodes.FST_ERR_CTP_INVALID_JSON_BODY ||
    error instanceof Fastify.errorCodes.FST_ERR_CTP_EMPTY_JSON_BODY ||
    error instanceof Fastify.errorCodes.FST_ERR_CTP_INVALID_CONTENT_LENGTH ||
    (error instanceof Error &&
      "code" in error &&
      error.code === "FST_ERR_VALIDATION");
  const nativeCode =
    error instanceof NativeFailure
      ? (
          {
            access_denied: "forbidden",
            unavailable: "dependency_unavailable",
            invalid_response: "dependency_unavailable",
            request_rejected: "request_rejected",
            revision_conflict: "revision_conflict",
            setup_required: "setup_required",
            last_administrator: "last_administrator",
            outcome_unknown: "outcome_unknown",
          } as const
        )[error.code]
      : null;
  const code =
    nativeCode ??
    (error instanceof AccessError
      ? error.code
      : invalidInput
        ? "invalid_request"
        : "dependency_unavailable");
  return {
    code,
    status: bodyTooLarge ? 413 : unsupportedType ? 415 : errorStatus[code],
    bodyTooLarge,
    category: nativeCode
      ? "native"
      : error instanceof AccessError
        ? "access"
        : invalidInput
          ? "request"
          : "unexpected",
  } as const;
}

/** No messages, payloads, headers, URLs or arbitrary vendor fields enter diagnostics. */
export function failureDiagnostic(error: unknown) {
  const kind =
    error instanceof TypeError
      ? "TypeError"
      : error instanceof SyntaxError
        ? "SyntaxError"
        : error instanceof Error
          ? "Error"
          : "non_error";
  // V8 includes the complete message before frames, including embedded newlines.
  // If that header cannot be identified exactly, omit location rather than parsing it.
  const header =
    error instanceof Error ? `${error.name}: ${error.message}\n` : null;
  const frames =
    error instanceof Error && header && error.stack?.startsWith(header)
      ? error.stack.slice(header.length)
      : "";
  const location = frames
    .split("\n")
    .map(
      (line) =>
        line.match(
          /^\s+at (?:.*\()?[^\n]*?\b(services\/access\/[a-zA-Z0-9_./-]+\.[cm]?[jt]s:\d+:\d+)\)?$/,
        )?.[1],
    )
    .find((line) => line !== undefined);
  return {
    kind,
    ...(error instanceof NativeFailure ? { nativeCode: error.code } : {}),
    ...(location ? { location } : {}),
  };
}
