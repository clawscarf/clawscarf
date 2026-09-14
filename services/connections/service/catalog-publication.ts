import { CommonError } from "../shared/errors.js";
import type { ConnectorCatalog } from "../types/catalog.js";
import type {
  CatalogPublication,
  PublishedConnector,
  CatalogPublicationRepository,
  CatalogPublicationStore,
} from "../types/catalog-publication.js";
import { ConnectionError } from "../types/errors.js";

/** Admission belongs in the same transaction as the new intent or dispatch record. */
export async function requirePublishedCatalog(
  store: CatalogPublicationStore,
  catalog: ConnectorCatalog,
  connectorId?: string,
): Promise<void> {
  const current = await store.lock("shared");
  if (!current || current.version !== catalog.version)
    throw new ConnectionError(
      "connector_catalog_changed",
      "The connection catalog changed. Retry after the deployment is updated.",
    );
  if (
    connectorId !== undefined &&
    (!catalog.get(connectorId) ||
      !current.connectors.some(
        (connector) =>
          connector.id === connectorId &&
          connector.toolkit === catalog.binding(connectorId)?.toolkit,
      ))
  )
    throw new ConnectionError(
      "connector_catalog_changed",
      "This service is no longer available for new connections or calls.",
    );
}

export function catalogPublication(
  catalog: ConnectorCatalog,
): CatalogPublication {
  const connectors: PublishedConnector[] = [];
  let cursor: string | undefined;
  do {
    const page = catalog.list({ limit: 100, ...(cursor ? { cursor } : {}) });
    for (const item of page.items) {
      const binding = catalog.binding(item.id);
      if (!binding)
        throw new CommonError(
          "invalid_request",
          "The catalog has an incomplete service binding.",
        );
      connectors.push({ id: item.id, toolkit: binding.toolkit });
    }
    cursor = page.nextCursor ?? undefined;
    if (connectors.length > 2000)
      throw new CommonError(
        "invalid_request",
        "The catalog exceeds its connector limit.",
      );
  } while (cursor);
  return {
    version: catalog.version,
    connectors: connectors.sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
  };
}

/** Deployment operators publish a verified artifact; tenant requests cannot select a catalog. */
export class CatalogPublicationService {
  constructor(private readonly repository: CatalogPublicationRepository) {}

  current() {
    return this.repository.transaction((store) => store.current());
  }

  publish(
    catalog: ConnectorCatalog,
    expectedVersion: string | null,
    dryRun = false,
  ) {
    const next = catalogPublication(catalog);
    return this.repository.transaction(async (store) => {
      const current = await store.lock(dryRun ? "shared" : "exclusive");
      const same =
        current?.version === next.version &&
        current.connectors.length === next.connectors.length &&
        current.connectors.every(
          (connector, index) =>
            connector.id === next.connectors[index]?.id &&
            connector.toolkit === next.connectors[index]?.toolkit,
        );
      if (!same && (current?.version ?? null) !== expectedVersion)
        throw new CommonError(
          "revision_conflict",
          "The published catalog changed. Read its current version before publishing.",
        );
      // Include operational facts even on initial publication, when no prior version is admitted.
      const proposed = new Map(
        next.connectors.map((connector) => [connector.id, connector.toolkit]),
      );
      const known = current?.connectors ?? [];
      const removed = known
        .filter((connector) => !proposed.has(connector.id))
        .map((connector) => connector.id);
      const replaced = known
        .filter(
          (connector) =>
            proposed.has(connector.id) &&
            proposed.get(connector.id) !== connector.toolkit,
        )
        .map((connector) => connector.id);
      const blockers = await store.retirementBlockers(next.connectors);
      if (blockers.total > 0)
        return {
          status: "blocked" as const,
          current,
          next,
          removedConnectorIds: removed,
          replacedConnectorIds: replaced,
          blockers,
        };
      if (dryRun)
        return {
          status: "preview" as const,
          current,
          next,
          removedConnectorIds: removed,
          replacedConnectorIds: replaced,
          blockers,
        };
      if (!same && !(await store.replace(expectedVersion, next)))
        throw new CommonError(
          "revision_conflict",
          "The published catalog changed.",
        );
      return {
        status: same ? ("already_published" as const) : ("published" as const),
        current: next,
        removedConnectorIds: removed,
        replacedConnectorIds: replaced,
        blockers,
      };
    });
  }
}
