import { createHash } from "node:crypto";
import type {
  ConnectorActionDetail,
  ConnectorActionSummary,
  ConnectorJson,
  ConnectorMetadata,
} from "../../types/catalog.js";

export interface ConnectorManifestEntry extends ConnectorMetadata {
  toolkitSlug: string;
}

export interface ConnectorManifest {
  source: { repository: string; revision: string; paths: string[] };
  connectors: ConnectorManifestEntry[];
}

export interface ConnectorCatalogIndex {
  version: string;
  manifestDigest: string;
  connectors: {
    metadata: ConnectorManifestEntry;
    actions: ConnectorActionSummary[];
    detailDigest: string;
    sourceDigest: string;
  }[];
}

export interface ConnectorCatalogDetail {
  connectorId: string;
  actions: ConnectorActionDetail[];
}

export function connectorActionSummary(
  action: ConnectorActionDetail,
): ConnectorActionSummary {
  return {
    id: action.id,
    connectorId: action.connectorId,
    name: action.name,
    description:
      action.description.length <= 500
        ? action.description
        : `${action.description.slice(0, 497)}...`,
    version: action.version,
    schemaDigest: action.schemaDigest,
  };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw Error("Catalog contains invalid JSON.");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(Reflect.get(value, key))}`,
    )
    .join(",")}}`;
}

export function catalogDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function parseCatalogJson(
  value: unknown,
  maximumBytes: number,
): ConnectorJson {
  let remainingNodes = 250_000;
  const visit = (candidate: unknown, depth: number): ConnectorJson => {
    if (--remainingNodes < 0 || depth > 80)
      throw Error("Catalog JSON is too complex.");
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    )
      return candidate;
    if (typeof candidate === "number" && Number.isFinite(candidate))
      return candidate;
    if (Array.isArray(candidate))
      return candidate.map((item: unknown) => visit(item, depth + 1));
    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate).map(([key, child]: [string, unknown]) => [
          key,
          visit(child, depth + 1),
        ]),
      );
    }
    throw Error("Catalog contains invalid JSON.");
  };
  const result = visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > maximumBytes)
    throw Error("Catalog JSON exceeds its byte limit.");
  return result;
}
