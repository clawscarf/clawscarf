import type { ConnectorJson } from "../types/catalog.js";

/** Bound traversal before serialization; callers own boundary-specific error translation. */
export function parseJson(
  value: unknown,
  options: {
    maximumDepth: number;
    maximumBytes?: number;
    plainObjectsOnly?: boolean;
    invalid: (reason: "complexity" | "value" | "bytes") => never;
  },
): ConnectorJson {
  let remaining = 250_000;
  const visit = (value: unknown, depth: number): ConnectorJson => {
    if (--remaining < 0 || depth > options.maximumDepth)
      options.invalid("complexity");
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return value;
    if (Array.isArray(value))
      return value.map((child: unknown) => visit(child, depth + 1));
    if (
      typeof value !== "object" ||
      value === null ||
      (options.plainObjectsOnly &&
        Object.getPrototypeOf(value) !== Object.prototype)
    )
      return options.invalid("value");
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        visit(child, depth + 1),
      ]),
    );
  };
  const result = visit(value, 0);
  if (
    options.maximumBytes !== undefined &&
    Buffer.byteLength(JSON.stringify(result)) > options.maximumBytes
  )
    options.invalid("bytes");
  return result;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("Invalid JSON value.");
    return encoded;
  }
  if (Array.isArray(value))
    return `[${value.map((item: unknown) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(Reflect.get(value, key))}`,
    )
    .join(",")}}`;
}
