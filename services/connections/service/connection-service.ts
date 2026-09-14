import { randomUUID } from "node:crypto";
import { missing } from "../shared/errors.js";
import { requirePage } from "../shared/pagination.js";
import type { Principal } from "../types/authority.js";
import type {
  ConnectorAdministratorVerifier,
  ConnectorServerScope,
} from "../types/authority.js";
import type { ConnectorCatalog } from "../types/catalog.js";
import type { ConnectionGrant, ConnectionRecord } from "../types/model.js";
import type {
  ConnectionProtection,
  ConnectionRepository,
} from "../types/ports.js";
import {
  requireConnectionGrant,
  parseConnectionGrant,
  requireConnectionName,
} from "../types/validation.js";
import { ConnectionError } from "../types/errors.js";
import {
  cancelSetup,
  checkConnectionRevision,
  connection,
  currentSetup,
  now,
  priorCommand,
  withAdministrator,
} from "./state.js";
import { connectionView, invocationView } from "./views.js";
import { requirePublishedCatalog } from "./catalog-publication.js";

export class ConnectionService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly verifier: ConnectorAdministratorVerifier,
    private readonly catalog: ConnectorCatalog,
    private readonly protection: ConnectionProtection,
  ) {}
  list(
    actor: Principal,
    scope: ConnectorServerScope,
    limit: number,
    cursor: string | null,
    includeDisconnected = false,
  ) {
    requirePage(limit, cursor);
    return withAdministrator(
      this.repository,
      this.verifier,
      actor,
      scope,
      "installation-connections:read",
      async (store) => {
        const page = await store.connections.list(
          scope,
          limit,
          cursor,
          includeDisconnected,
        );
        return {
          items: await Promise.all(
            page.items.map((r) => connectionView(store, r)),
          ),
          nextCursor: page.nextCursor,
        };
      },
    );
  }
  get(actor: Principal, scope: ConnectorServerScope, id: string) {
    return withAdministrator(
      this.repository,
      this.verifier,
      actor,
      scope,
      "installation-connections:read",
      async (store) =>
        connectionView(store, await connection(store, scope, id)),
    );
  }
  getInvocation(actor: Principal, scope: ConnectorServerScope, id: string) {
    return withAdministrator(
      this.repository,
      this.verifier,
      actor,
      scope,
      "installation-connection-invocations:read",
      async (store) => {
        const receipt = await store.invocations.get(scope, id);
        if (!receipt) missing();
        return invocationView(receipt);
      },
    );
  }
  create(
    actor: Principal,
    scope: ConnectorServerScope,
    key: string,
    input: { connectorId: string; name: string; grant: ConnectionGrant },
  ) {
    requireConnectionName(input.name);
    return withAdministrator(
      this.repository,
      this.verifier,
      actor,
      scope,
      "installation-connections:write",
      async (store) => {
        const { fingerprint, previous } = await priorCommand(
          store,
          this.protection,
          actor,
          scope,
          key,
          { kind: "create", ...input },
        );
        if (previous)
          return connectionView(
            store,
            await connection(store, scope, previous.resourceId),
          );
        await requirePublishedCatalog(
          store.catalogPublication,
          this.catalog,
          input.connectorId,
        );
        const grant = parseConnectionGrant(input.grant);
        // The broker's bounded discovery set must never silently omit usable accounts.
        const existing = await store.connections.count(scope);
        if (existing >= 500)
          throw new ConnectionError(
            "connector_capacity_exceeded",
            "This installation reached its connection capacity.",
          );
        const record: ConnectionRecord = {
          ...scope,
          id: randomUUID(),
          connectorId: input.connectorId,
          name: input.name,
          grant,
          state: "not_connected",
          generation: 1,
          revision: 1,
          activeAccountId: null,
          failure: null,
          createdAt: now(),
          updatedAt: now(),
        };
        await store.connections.save(record);
        await store.connections.saveCommand(scope, {
          actorId: actor.user.id,
          key,
          fingerprint,
          resourceId: record.id,
        });
        return connectionView(store, record);
      },
    );
  }
  update(
    actor: Principal,
    scope: ConnectorServerScope,
    id: string,
    revision: number,
    key: string,
    input: { name: string; grant: ConnectionGrant },
  ) {
    requireConnectionName(input.name);
    return withAdministrator(
      this.repository,
      this.verifier,
      actor,
      scope,
      "installation-connections:write",
      async (store, proof) => {
        const { fingerprint, previous } = await priorCommand(
          store,
          this.protection,
          actor,
          scope,
          key,
          { kind: "update", id, revision, ...input },
        );
        const record = await connection(store, scope, id);
        if (previous) return connectionView(store, record);
        checkConnectionRevision(record, revision);
        const updated = {
          ...record,
          name: input.name,
          grant: requireConnectionGrant(
            input.grant,
            proof.agentIds,
            record.grant,
          ),
          revision: record.revision + 1,
          updatedAt: now(),
        };
        await store.connections.save(updated);
        await store.connections.saveCommand(scope, {
          actorId: actor.user.id,
          key,
          fingerprint,
          resourceId: id,
        });
        return connectionView(store, updated);
      },
    );
  }
  disconnect(
    actor: Principal,
    scope: ConnectorServerScope,
    id: string,
    revision: number,
    key: string,
  ) {
    return withAdministrator(
      this.repository,
      this.verifier,
      actor,
      scope,
      "installation-connections:write",
      async (store) => {
        const { fingerprint, previous } = await priorCommand(
          store,
          this.protection,
          actor,
          scope,
          key,
          { kind: "disconnect", id, revision },
        );
        const record = await connection(store, scope, id);
        if (previous) return connectionView(store, record);
        checkConnectionRevision(record, revision);
        const setup = await currentSetup(store, scope, id);
        if (setup) await cancelSetup(store, setup, "cancelled");
        const updated: ConnectionRecord = {
          ...record,
          state: "disconnected",
          activeAccountId: null,
          generation: record.generation + 1,
          revision: record.revision + 1,
          failure: null,
          updatedAt: now(),
        };
        await store.connections.save(updated);
        for (const account of await store.accounts.forConnection(scope, id))
          if (account.state !== "cleanup")
            await store.accounts.save({
              ...account,
              state: "cleanup",
              cleanup: "pending",
              nextAttemptAt: now(),
            });
        await store.connections.saveCommand(scope, {
          actorId: actor.user.id,
          key,
          fingerprint,
          resourceId: id,
        });
        return connectionView(store, updated);
      },
    );
  }
}
