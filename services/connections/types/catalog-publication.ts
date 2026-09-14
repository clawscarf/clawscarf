export interface PublishedConnector {
  id: string;
  toolkit: string;
}

export interface CatalogPublication {
  version: string;
  connectors: readonly PublishedConnector[];
}

export interface CatalogPublicationBlocker {
  connectorId: string;
  kind: "connection" | "account" | "setup" | "invocation";
  resourceId: string;
  serverId: string;
}

export interface CatalogPublicationBlockers {
  total: number;
  items: CatalogPublicationBlocker[];
  truncated: boolean;
}

/** Locks last until the owning transaction commits or rolls back. */
export interface CatalogPublicationStore {
  /** Observation only; it does not authorize a new effect. */
  current(): Promise<CatalogPublication | null>;
  lock(mode: "shared" | "exclusive"): Promise<CatalogPublication | null>;
  /** A bounded diagnostic sample and exact total, read while holding the catalog lock. */
  retirementBlockers(
    nextConnectors: readonly PublishedConnector[],
  ): Promise<CatalogPublicationBlockers>;
  /** Requires the exclusive lock; no activation or external effects occur implicitly. */
  replace(
    expectedVersion: string | null,
    next: CatalogPublication,
  ): Promise<boolean>;
}

/** Deployment tooling needs catalog transactions without installation or provider capabilities. */
export interface CatalogPublicationRepository {
  transaction<T>(
    work: (store: CatalogPublicationStore) => Promise<T>,
  ): Promise<T>;
}
