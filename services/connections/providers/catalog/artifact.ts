import { parseJson, canonicalJson } from "../../shared/json.js";
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

export function catalogDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function parseCatalogJson(
  value: unknown,
  maximumBytes: number,
): ConnectorJson {
  return parseJson(value, {
    maximumDepth: 80,
    maximumBytes,
    invalid: (reason) => {
      throw Error(
        {
          complexity: "Catalog JSON is too complex.",
          value: "Catalog contains invalid JSON.",
          bytes: "Catalog JSON exceeds its byte limit.",
        }[reason],
      );
    },
  });
}
