import { CommonError } from "./errors.js";

export function bounded(value: unknown, label: string, max = 80): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted input.
    /[\x00-\x1f\x7f]/u.test(value)
  )
    throw new CommonError(
      "invalid_request",
      `${label} must contain 1–${max} characters.`,
    );
  return value.trim();
}

export function requireId(value: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new CommonError("invalid_request", "Provide a valid resource ID.");
}
