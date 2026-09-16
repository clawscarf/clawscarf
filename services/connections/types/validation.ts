import { parseJson } from "../shared/json.js";
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
  return parseJson(value, {
    maximumDepth: 64,
    maximumBytes,
    plainObjectsOnly: true,
    invalid,
  });
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
