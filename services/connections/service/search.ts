import { CommonError } from "../shared/errors.js";
import type { Page } from "../shared/pagination.js";
import type {
  ConnectorActionSummary,
  ConnectorCatalog,
  ConnectorCatalogQuery,
  ConnectorJson,
} from "../types/catalog.js";
import { ConnectionError } from "../types/errors.js";
import type { ConnectionRecord } from "../types/model.js";
import type { ConnectionProtection } from "../types/ports.js";

const catalogPageSize = 100;
interface SearchPosition {
  page: string | null;
  action: number;
  connection: number;
}
interface SearchCursor extends SearchPosition {
  signature: string;
}
interface SearchMatch {
  connection: Pick<
    ConnectionRecord,
    "id" | "name" | "connectorId" | "generation"
  >;
  action: ConnectorActionSummary;
}

/** The caller authorizes these records and the runtime principal before entering. */
export function searchConnections(input: {
  catalog: ConnectorCatalog;
  connections: readonly ConnectionRecord[];
  query: ConnectorCatalogQuery & {
    connectionId?: string;
    connectorId?: string;
  };
  protection: Pick<ConnectionProtection, "fingerprint">;
  binding: string;
  authority: ConnectorJson;
}): Page<SearchMatch> {
  const limit = input.query.limit ?? 10;
  const text = (input.query.text ?? "").trim().toLowerCase();
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 25 ||
    (input.query.text?.length ?? 0) > 500
  )
    throw new CommonError(
      "invalid_request",
      "Connection search limits are invalid.",
    );
  const connections = input.connections
    .filter(
      (record) =>
        (!input.query.connectionId || record.id === input.query.connectionId) &&
        (!input.query.connectorId ||
          record.connectorId === input.query.connectorId),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  if (connections.length > 500)
    throw new ConnectionError(
      "connector_capacity_exceeded",
      "Narrow the connection search.",
    );
  const byConnector = new Map<string, ConnectionRecord[]>();
  for (const record of connections) {
    const accounts = byConnector.get(record.connectorId) ?? [];
    accounts.push(record);
    byConnector.set(record.connectorId, accounts);
  }
  const scope = input.protection.fingerprint(input.binding, {
    kind: "connection-search",
    catalogVersion: input.catalog.version,
    authority: input.authority,
    text,
    connectionId: input.query.connectionId ?? null,
    connectorId: input.query.connectorId ?? null,
    connections: connections.map((record) => ({
      id: record.id,
      connectorId: record.connectorId,
      generation: record.generation,
      revision: record.revision,
    })),
  });
  const sign = (position: SearchPosition) =>
    input.protection.fingerprint(input.binding, {
      kind: "connection-search-cursor",
      scope,
      ...position,
    });
  let position: SearchPosition = { page: null, action: 0, connection: 0 };
  if (input.query.cursor !== undefined) {
    const cursor = decodeCursor(input.query.cursor);
    position = {
      page: cursor.page,
      action: cursor.action,
      connection: cursor.connection,
    };
    if (cursor.signature !== sign(position)) invalidCursor();
  }
  const items: SearchMatch[] = [];
  const visited = new Set<string | null>();
  for (;;) {
    if (visited.has(position.page))
      throw Error("Connector catalog repeated a search page.");
    visited.add(position.page);
    const page = input.catalog.search({
      text,
      connectorIds: [...byConnector.keys()].sort(),
      limit: catalogPageSize,
      ...(position.page ? { cursor: position.page } : {}),
    });
    if (
      !page.items.length &&
      position.action === 0 &&
      position.connection === 0 &&
      page.nextCursor === null
    )
      return { items, nextCursor: null };
    if (position.action >= page.items.length) invalidCursor();
    while (position.action < page.items.length) {
      const action = page.items[position.action]!;
      const accounts = byConnector.get(action.connectorId);
      if (!accounts?.length)
        throw Error(
          "Connector catalog returned an action outside the requested scope.",
        );
      if (position.connection >= accounts.length) invalidCursor();
      const account = accounts[position.connection]!;
      items.push({
        connection: {
          id: account.id,
          name: account.name,
          connectorId: account.connectorId,
          generation: account.generation,
        },
        action: structuredClone(action),
      });
      position.connection++;
      if (position.connection === accounts.length) {
        position.connection = 0;
        position.action++;
      }
      if (position.action === page.items.length) {
        if (!page.nextCursor) return { items, nextCursor: null };
        position = { page: page.nextCursor, action: 0, connection: 0 };
        break;
      }
      if (items.length === limit)
        return { items, nextCursor: encodeCursor(position, sign(position)) };
    }
    if (items.length === limit)
      return { items, nextCursor: encodeCursor(position, sign(position)) };
  }
}

function encodeCursor(position: SearchPosition, signature: string): string {
  return Buffer.from(JSON.stringify({ ...position, signature })).toString(
    "base64url",
  );
}
function decodeCursor(value: string): SearchCursor {
  if (!value || value.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(value))
    invalidCursor();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    invalidCursor();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    invalidCursor();
  if (
    Object.keys(parsed).length !== 4 ||
    !("page" in parsed) ||
    !("action" in parsed) ||
    !("connection" in parsed) ||
    !("signature" in parsed)
  )
    invalidCursor();
  const { page, action, connection, signature } = parsed;
  if (
    (page !== null &&
      (typeof page !== "string" || !page || page.length > 512)) ||
    typeof action !== "number" ||
    !Number.isSafeInteger(action) ||
    action < 0 ||
    action >= catalogPageSize ||
    typeof connection !== "number" ||
    !Number.isSafeInteger(connection) ||
    connection < 0 ||
    connection > 499 ||
    typeof signature !== "string" ||
    !signature ||
    signature.length > 256
  )
    invalidCursor();
  return { page, action, connection, signature };
}
function invalidCursor(): never {
  throw new CommonError(
    "invalid_request",
    "Connection search changed or its cursor is invalid.",
  );
}
