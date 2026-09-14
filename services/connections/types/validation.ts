import { CommonError } from "../shared/errors.js";
import type { ConnectorJson } from "./catalog.js";
import type { ConnectionGrant, ConnectorCallContext } from "./model.js";
function invalid(): never {
  throw new CommonError("invalid_request", "Connection input is invalid.");
}
export function requireConnectorJson(
  value: unknown,
  maximumBytes = 128 * 1024,
): ConnectorJson {
  let remaining = 250_000;
  const visit = (input: unknown, depth: number): ConnectorJson => {
    if (--remaining < 0 || depth > 64) invalid();
    if (
      input === null ||
      typeof input === "boolean" ||
      typeof input === "string"
    )
      return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (Array.isArray(input))
      return input.map((item: unknown) => visit(item, depth + 1));
    if (
      typeof input !== "object" ||
      input === null ||
      Object.getPrototypeOf(input) !== Object.prototype
    )
      invalid();
    const result: { [key: string]: ConnectorJson } = {};
    for (const [key, item] of Object.entries(input))
      Object.defineProperty(result, key, {
        value: visit(item, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return result;
  };
  const parsed = visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(parsed)) > maximumBytes) invalid();
  return parsed;
}
export function canonicalConnectorJson(value: ConnectorJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(canonicalConnectorJson).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map(
        (key) =>
          JSON.stringify(key) + ":" + canonicalConnectorJson(value[key]!),
      )
      .join(",") +
    "}"
  );
}
export function requireConnectionName(name: string) {
  if (name.length < 1 || name.length > 160 || name.trim() !== name) invalid();
  return name;
}
/** Proposed grants are inert until activation checks native authority and inventory. */
export function parseConnectionGrant(grant: ConnectionGrant): ConnectionGrant {
  if (grant.mode === "all") return { mode: "all" };
  if (
    grant.mode !== "selected" ||
    !grant.agentIds.length ||
    grant.agentIds.length > 500 ||
    new Set(grant.agentIds).size !== grant.agentIds.length ||
    grant.agentIds.some((id) => !id || id.length > 160)
  )
    invalid();
  return { mode: "selected", agentIds: [...grant.agentIds] };
}
export function requireConnectionGrant(
  grant: ConnectionGrant,
  knownIds: readonly string[],
  previous?: ConnectionGrant,
): ConnectionGrant {
  const parsed = parseConnectionGrant(grant);
  const retained = previous?.mode === "selected" ? previous.agentIds : [];
  if (
    parsed.mode === "selected" &&
    parsed.agentIds.some(
      (id) => !knownIds.includes(id) && !retained.includes(id),
    )
  )
    invalid();
  return parsed;
}
export function requireConnectionKey(key: string) {
  if (!/^[!-~]{1,200}$/.test(key)) invalid();
}
export function requireConnectorContext(
  context: ConnectorCallContext,
  call = false,
) {
  if (
    !context.agentId ||
    context.agentId.length > 160 ||
    !context.toolCallId ||
    context.toolCallId.length > 500 ||
    (context.sessionId !== undefined &&
      (!context.sessionId || context.sessionId.length > 500)) ||
    (context.sessionKey !== undefined &&
      (!context.sessionKey || context.sessionKey.length > 1000)) ||
    (call && !context.sessionId && !context.sessionKey)
  )
    invalid();
}
