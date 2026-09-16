import { CommonError } from "./errors.js";
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export function requirePage(limit: number, cursor: string | null): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new CommonError(
      "invalid_request",
      "Limit must be between 1 and 100.",
    );
  if (cursor !== null) requireId(cursor);
}

export function page(limit: number | string | null, cursor: string | null) {
  const n = limit === null ? 25 : Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > 100)
    throw new CommonError(
      "invalid_request",
      "Limit must be between 1 and 100.",
    );
  let after: string | null = null;
  if (cursor) {
    try {
      after = Buffer.from(cursor, "base64url").toString();
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          after,
        )
      )
        throw Error();
    } catch {
      throw new CommonError("invalid_request", "Invalid page cursor.");
    }
  }
  return { limit: n, cursor: after };
}

function requireId(value: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new CommonError("invalid_request", "Provide a valid resource ID.");
}
