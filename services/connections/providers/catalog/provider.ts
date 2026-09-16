import { join } from "node:path";
import { CommonError } from "../../shared/errors.js";
import type { Page } from "../../shared/pagination.js";
import type {
  Connector,
  ConnectorActionDetail,
  ConnectorActionSummary,
  ConnectorCatalog,
  ConnectorCatalogBinding,
  ConnectorCatalogQuery,
} from "../../types/catalog.js";
import {
  catalogDigest,
  connectorActionSummary,
  type ConnectorCatalogDetail,
  type ConnectorCatalogIndex,
} from "./artifact.js";
import { readCatalogDetail, readCatalogIndex } from "./validation.js";
import { readCatalogFile } from "./files.js";

export async function openConnectorCatalog(
  directory: string,
  options: { verifyDetails?: boolean } = {},
): Promise<ConnectorCatalog> {
  const raw = await readCatalogFile(
    join(directory, "index.json"),
    64 * 1024 * 1024,
  );
  const index = readCatalogIndex(raw);
  const catalog = new FileConnectorCatalog(index, async (id) => {
    const detail = await readCatalogFile(
      join(directory, `${id}.json`),
      128 * 1024 * 1024,
    );
    return readCatalogDetail(detail);
  });
  if (options.verifyDetails) await catalog.verifyDetails();
  return catalog;
}

export class FileConnectorCatalog implements ConnectorCatalog {
  readonly version: string;
  readonly #entries: ConnectorCatalogIndex["connectors"];
  readonly #details = new Map<string, Promise<ConnectorCatalogDetail>>();

  constructor(
    index: ConnectorCatalogIndex,
    private readonly load: (id: string) => Promise<ConnectorCatalogDetail>,
  ) {
    const checked = readCatalogIndex(structuredClone(index));
    this.version = checked.version;
    this.#entries = checked.connectors;
  }

  list(
    query: ConnectorCatalogQuery & { category?: string } = {},
  ): Page<Connector> {
    const text = normalizedQuery(query.text);
    const rows = this.#entries
      .filter(
        (entry) =>
          !query.category || entry.metadata.category === query.category,
      )
      .filter((entry) =>
        matches(
          [entry.metadata.id, entry.metadata.name, entry.metadata.description],
          text,
        ),
      )
      .map((entry) => this.#connector(entry));
    rows.sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
    return paginate(rows, query, {
      version: this.version,
      kind: "connectors",
      text,
      category: query.category ?? null,
    });
  }

  get(connectorId: string): Connector | null {
    const entry = this.#entries.find(
      (entry) => entry.metadata.id === connectorId,
    );
    return entry ? this.#connector(entry) : null;
  }

  binding(connectorId: string): ConnectorCatalogBinding | null {
    const entry = this.#entries.find(
      (entry) => entry.metadata.id === connectorId,
    );
    return entry
      ? {
          toolkit: entry.metadata.toolkitSlug,
          auth: structuredClone(entry.metadata.auth),
        }
      : null;
  }

  search(
    query: ConnectorCatalogQuery & { connectorIds: readonly string[] },
  ): Page<ConnectorActionSummary> {
    const text = normalizedQuery(query.text);
    const ids = [...new Set(query.connectorIds)].sort();
    const rows = this.#entries
      .filter((entry) => ids.includes(entry.metadata.id))
      .flatMap((entry) => entry.actions)
      .map((action) => ({ action, rank: relevance(action, text) }))
      .filter((row) => row.rank >= 0)
      .sort(
        (left, right) =>
          right.rank - left.rank ||
          left.action.id.localeCompare(right.action.id) ||
          left.action.connectorId.localeCompare(right.action.connectorId),
      )
      .map((row) => row.action);
    return paginate(rows, query, {
      version: this.version,
      kind: "actions",
      text,
      connectorIds: ids,
    });
  }

  async describe(
    connectorId: string,
    actionId: string,
  ): Promise<ConnectorActionDetail | null> {
    const entry = this.#entries.find(
      (entry) => entry.metadata.id === connectorId,
    );
    if (!entry || !entry.actions.some((action) => action.id === actionId))
      return null;
    return structuredClone(
      (await this.#detail(entry)).actions.find(
        (action) => action.id === actionId,
      ) ?? null,
    );
  }

  /** Deployment publication validates every referenced file, not only queried actions. */
  async verifyDetails(): Promise<void> {
    for (const entry of this.#entries) await this.#detail(entry);
  }

  #detail(entry: ConnectorCatalogIndex["connectors"][number]) {
    const connectorId = entry.metadata.id;
    let pending = this.#details.get(connectorId);
    if (!pending) {
      pending = this.load(connectorId).then((value) => {
        const detail = readCatalogDetail(value);
        if (
          detail.connectorId !== connectorId ||
          catalogDigest(detail) !== entry.detailDigest
        )
          throw Error("Connector detail integrity mismatch.");
        const summaries = detail.actions.map(connectorActionSummary);
        if (catalogDigest(summaries) !== catalogDigest(entry.actions))
          throw Error("Connector catalog summary mismatch.");
        return detail;
      });
      this.#details.set(connectorId, pending);
      void pending.catch(() => {
        if (this.#details.get(connectorId) === pending)
          this.#details.delete(connectorId);
      });
    }
    return pending;
  }

  #connector(entry: ConnectorCatalogIndex["connectors"][number]): Connector {
    const { id, name, description, category, iconUrl, auth } = entry.metadata;
    const metadata = { id, name, description, category, iconUrl, auth };
    return {
      ...structuredClone(metadata),
      catalogVersion: this.version,
      actionCount: entry.actions.length,
    };
  }
}

function normalizedQuery(value = ""): string {
  if (value.length > 500)
    throw new CommonError("invalid_request", "Search is too long.");
  return value.trim().toLowerCase();
}
function matches(values: string[], text: string): boolean {
  const haystack = values.join(" ").toLowerCase().replaceAll("_", " ");
  return text
    .split(/\s+/u)
    .every((term) => haystack.includes(term.replaceAll("_", " ")));
}
function relevance(action: ConnectorActionSummary, text: string): number {
  if (
    !matches(
      [action.id, action.name, action.description, action.connectorId],
      text,
    )
  )
    return -1;
  if (!text) return 0;
  if (action.id.toLowerCase() === text || action.name.toLowerCase() === text)
    return 100;
  return action.name.toLowerCase().includes(text) ? 10 : 1;
}
function paginate<T>(
  rows: T[],
  query: ConnectorCatalogQuery,
  scope: unknown,
): Page<T> {
  const limit = query.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new CommonError(
      "invalid_request",
      "Limit must be between 1 and 100.",
    );
  const fingerprint = catalogDigest(scope);
  let offset = 0;
  if (query.cursor) {
    if (query.cursor.length > 512)
      throw new CommonError("invalid_request", "Invalid catalog cursor.");
    try {
      const cursor: unknown = JSON.parse(
        Buffer.from(query.cursor, "base64url").toString("utf8"),
      );
      if (
        !cursor ||
        typeof cursor !== "object" ||
        !("scope" in cursor) ||
        cursor.scope !== fingerprint ||
        !("offset" in cursor) ||
        typeof cursor.offset !== "number" ||
        !Number.isSafeInteger(cursor.offset) ||
        cursor.offset < 0 ||
        cursor.offset > rows.length
      )
        throw Error();
      offset = cursor.offset;
    } catch {
      throw new CommonError(
        "invalid_request",
        "Catalog changed or its cursor is invalid.",
      );
    }
  }
  const next = offset + limit;
  return {
    items: structuredClone(rows.slice(offset, next)),
    nextCursor:
      next < rows.length
        ? Buffer.from(
            JSON.stringify({ scope: fingerprint, offset: next }),
          ).toString("base64url")
        : null,
  };
}
