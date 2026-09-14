import type { Page } from "../shared/pagination.js";

export type ConnectorJson =
  | null
  | boolean
  | number
  | string
  | ConnectorJson[]
  | { [key: string]: ConnectorJson };

export type ConnectorAuth =
  { kind: "managed" } | { kind: "custom"; scheme: string };

export interface ConnectorMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  iconUrl: string;
  auth: ConnectorAuth;
}

export interface Connector extends ConnectorMetadata {
  catalogVersion: string;
  actionCount: number;
}

export interface ConnectorActionSummary {
  id: string;
  name: string;
  description: string;
  connectorId: string;
  version: string;
  schemaDigest: string;
}

/** Provider schemas are advisory data, not application validators. */
export interface ConnectorActionDetail extends ConnectorActionSummary {
  inputSchema: ConnectorJson;
  outputSchema: ConnectorJson;
  fileInputs: string[];
  fileOutputs: string[];
}

export interface ConnectorCatalogQuery {
  text?: string;
  limit?: number;
  cursor?: string;
}

export interface ConnectorCatalogBinding {
  toolkit: string;
  auth: ConnectorAuth;
}

export interface ConnectorCatalog {
  readonly version: string;
  list(query?: ConnectorCatalogQuery & { category?: string }): Page<Connector>;
  get(connectorId: string): Connector | null;
  binding(connectorId: string): ConnectorCatalogBinding | null;
  search(
    query: ConnectorCatalogQuery & { connectorIds: readonly string[] },
  ): Page<ConnectorActionSummary>;
  describe(
    connectorId: string,
    actionId: string,
  ): Promise<ConnectorActionDetail | null>;
}

export interface ConnectorCatalogReference {
  connectorId: string;
  kind: "connection" | "setup" | "cleanup" | "invocation";
  resourceId: string;
}

/** An explicit caller-owned snapshot, not authorization to deploy a catalog. */
export interface ConnectorCatalogUsage {
  catalogVersion: string;
  references: ConnectorCatalogReference[];
}

export interface ConnectorCatalogRetirement {
  removedConnectorIds: string[];
  blockers: ConnectorCatalogReference[];
}
