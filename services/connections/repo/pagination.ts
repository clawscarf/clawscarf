import type { Page } from "../shared/pagination.js";
export const paged = <T>(
  items: T[],
  limit: number,
  id: (item: T) => string,
): Page<T> => ({
  items: items.slice(0, limit),
  nextCursor:
    items.length > limit
      ? Buffer.from(id(items[limit - 1]!)).toString("base64url")
      : null,
});
