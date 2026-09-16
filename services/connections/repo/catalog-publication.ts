import { checkConnectionsSchema } from "./schema.js";
import {
  oneRow,
  transaction,
  type Database,
  type Transaction,
} from "./database.js";
import type {
  CatalogPublication,
  PublishedConnector,
  CatalogPublicationBlocker,
  CatalogPublicationBlockers,
  CatalogPublicationStore,
  CatalogPublicationRepository,
} from "../types/catalog-publication.js";

interface PublicationRow {
  version: string | null;
  connectors: PublishedConnector[];
}

function view(row: PublicationRow): CatalogPublication | null {
  return row.version === null
    ? null
    : { version: row.version, connectors: row.connectors };
}

export class PostgresCatalogPublicationRepository implements CatalogPublicationRepository {
  constructor(private readonly pool: Database) {}

  transaction<T>(
    work: (store: CatalogPublicationStore) => Promise<T>,
  ): Promise<T> {
    return transaction(this.pool, (client) =>
      work(new PostgresCatalogPublicationStore(client)),
    );
  }

  checkSchema() {
    return transaction(this.pool, checkConnectionsSchema);
  }
}

/** The singleton row serializes first publication as well as subsequent version changes. */
export class PostgresCatalogPublicationStore implements CatalogPublicationStore {
  #locked: "shared" | "exclusive" | null = null;

  constructor(private readonly client: Transaction) {}

  async current() {
    return view(
      oneRow(
        await this.client.query<PublicationRow>(
          "SELECT version,connectors FROM connection_catalog_publication WHERE singleton=1",
        ),
      ),
    );
  }

  async lock(mode: "shared" | "exclusive") {
    const row = oneRow(
      await this.client.query<PublicationRow>(
        mode === "exclusive"
          ? "SELECT version,connectors FROM connection_catalog_publication WHERE singleton=1 FOR UPDATE"
          : "SELECT version,connectors FROM connection_catalog_publication WHERE singleton=1 FOR SHARE",
      ),
    );
    if (this.#locked !== "exclusive") this.#locked = mode;
    return view(row);
  }

  async retirementBlockers(
    nextConnectors: readonly PublishedConnector[],
  ): Promise<CatalogPublicationBlockers> {
    if (!this.#locked)
      throw Error("Catalog inspection requires its transaction lock.");
    const result = await this.client.query<{
      total: string;
      items: CatalogPublicationBlocker[];
    }>(
      `WITH proposed AS MATERIALIZED (
         SELECT id,toolkit FROM jsonb_to_recordset($1::jsonb) AS binding(id text,toolkit text)
       ), admitted AS MATERIALIZED (
         SELECT binding.id,binding.toolkit FROM connection_catalog_publication publication
         CROSS JOIN LATERAL jsonb_to_recordset(publication.connectors) AS binding(id text,toolkit text)
         WHERE publication.singleton=1 AND publication.version IS NOT NULL
       ), selected AS MATERIALIZED (
         SELECT id,connector_id,server_id,state FROM connections c
         WHERE NOT EXISTS(SELECT 1 FROM proposed p JOIN admitted a ON a.id=p.id AND a.toolkit=p.toolkit
           WHERE p.id=c.connector_id)
       ), blockers AS MATERIALIZED (
         SELECT c.connector_id,'connection'::text AS kind,c.id AS resource_id,c.server_id
           FROM selected c WHERE c.state<>'disconnected'
         UNION ALL
         SELECT c.connector_id,'account',a.id,c.server_id
           FROM selected c JOIN connection_accounts a ON a.connection_id=c.id
           WHERE a.state IN ('candidate','active') OR a.cleanup IN ('pending','running','needs_attention')
         UNION ALL
         SELECT c.connector_id,'setup',s.id,c.server_id
           FROM selected c JOIN connection_setups s ON s.connection_id=c.id
           WHERE s.state IN ('creating','pending','verifying','outcome_unknown')
             OR (s.allocation_dispatched_at IS NOT NULL AND s.account_id IS NULL)
             OR (s.preparation_dispatched_at IS NOT NULL AND s.prepared_auth IS NULL)
         UNION ALL
         SELECT c.connector_id,'invocation',i.id,c.server_id
           FROM selected c JOIN connection_invocations i ON i.connection_id=c.id WHERE i.state='dispatching'
       ) SELECT (SELECT count(*)::text FROM blockers) AS total,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'connectorId',connector_id,'kind',kind,'resourceId',resource_id,
           'serverId',server_id)
           ORDER BY connector_id,kind,resource_id)
           FROM (SELECT * FROM blockers ORDER BY connector_id,kind,resource_id LIMIT 100) sample),'[]'::jsonb) AS items`,
      [JSON.stringify(nextConnectors)],
    );
    const row = oneRow(result);
    const total = Number(row.total);
    if (!Number.isSafeInteger(total) || total < 0)
      throw Error("Catalog blocker count exceeds its supported range.");
    return { total, items: row.items, truncated: total > row.items.length };
  }

  async replace(expectedVersion: string | null, next: CatalogPublication) {
    if (this.#locked !== "exclusive")
      throw Error(
        "Catalog publication requires its exclusive transaction lock.",
      );
    const result = await this.client.query<{ singleton: number }>(
      `UPDATE connection_catalog_publication SET version=$2,connectors=$3::jsonb
       WHERE singleton=1 AND version IS NOT DISTINCT FROM $1::text
         AND (version IS DISTINCT FROM $2::text OR connectors=$3::jsonb)
       RETURNING singleton`,
      [expectedVersion, next.version, JSON.stringify(next.connectors)],
    );
    return result.rowCount === 1;
  }
}
