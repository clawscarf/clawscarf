import { randomUUID } from "node:crypto";
import { denied, missing } from "../shared/errors.js";
import type { Principal } from "../types/authority.js";
import type {
  ConnectorAdministratorVerifier,
  ConnectorServerScope,
} from "../types/authority.js";
import type { ConnectorCatalog } from "../types/catalog.js";
import type {
  ConnectionProtection,
  ConnectionRepository,
} from "../types/ports.js";
import type { ConnectionSetupRecord } from "../types/model.js";
import type { ConnectorProvider } from "../types/provider.js";
import { ConnectionError } from "../types/errors.js";
import {
  checkConnectionRevision,
  connection,
  currentSetup,
  now,
  pendingSetup,
  priorCommand,
  withAdministrator,
  cancelSetup,
} from "./state.js";
import { ConnectionCallbackService } from "./callback-service.js";
import { setupView } from "./views.js";
import { ConnectionSetupDispatcher } from "./setup-dispatch.js";
import { requirePublishedCatalog } from "./catalog-publication.js";

/** A durable setup intent precedes provider allocation. Replays never allocate another account. */
export class ConnectionSetupService {
  private readonly callbacks: ConnectionCallbackService;
  private readonly dispatcher: ConnectionSetupDispatcher;
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly verifier: ConnectorAdministratorVerifier,
    private readonly catalog: ConnectorCatalog,
    private readonly protection: ConnectionProtection,
    provider: ConnectorProvider,
    private readonly projectId: string,
    callbackUrl: string,
  ) {
    this.dispatcher = new ConnectionSetupDispatcher(
      repository,
      verifier,
      catalog,
      protection,
      provider,
      projectId,
      callbackUrl,
    );
    this.callbacks = new ConnectionCallbackService(
      repository,
      verifier,
      protection,
      provider,
      projectId,
    );
  }
  async start(
    actor: Principal,
    scope: ConnectorServerScope,
    id: string,
    revision: number,
    key: string,
    kind: "initial" | "reconnect",
  ) {
    const prepared = await withAdministrator(
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
          { kind: "setup", connectionId: id, revision, setupKind: kind },
        );
        if (previous) {
          const setup = await store.setups.get(scope, previous.resourceId);
          if (!setup) missing();
          const current = await currentSetup(store, scope, setup.connectionId);
          return current?.id === setup.id ? current : setup;
        }
        const record = await connection(store, scope, id);
        checkConnectionRevision(record, revision);
        await requirePublishedCatalog(
          store.catalogPublication,
          this.catalog,
          record.connectorId,
        );
        const latest = await currentSetup(store, scope, id);
        if (
          latest &&
          (pendingSetup(latest) || latest.state === "outcome_unknown")
        )
          throw new ConnectionError(
            "connection_setup_pending",
            "Inspect or cancel the current setup before starting another.",
          );
        if ((kind === "reconnect") !== (record.activeAccountId !== null))
          throw new ConnectionError(
            "connection_unavailable",
            "Choose setup or reconnect for this connection's current state.",
          );
        if (
          record.state === "disconnected" &&
          (await store.connections.count(scope)) >= 500
        )
          throw new ConnectionError(
            "connector_capacity_exceeded",
            "This installation reached its connection capacity.",
          );
        const setup: ConnectionSetupRecord = {
          ...scope,
          id: randomUUID(),
          connectionId: id,
          initiatorId: actor.user.id,
          actor: {
            userId: actor.user.id,
            sessionHash: actor.sessionHash,
          },
          sessionHash: proof.sessionHash,
          subjectId: this.protection.subject(actor.user.id),
          projectId: this.projectId,
          kind,
          state: "creating",
          accountId: null,
          sealedUrl: null,
          allocationDispatchedAt: null,
          preparationDispatchedAt: null,
          preparationCatalogVersion: null,
          preparedAuth: null,
          createdAt: now(),
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          completedAt: null,
          failure: null,
        };
        await store.setups.save(setup);
        await store.connections.save({
          ...record,
          state:
            record.state === "disconnected" ? "not_connected" : record.state,
          revision: record.revision + 1,
          updatedAt: now(),
        });
        await store.connections.saveCommand(scope, {
          actorId: actor.user.id,
          key,
          fingerprint,
          resourceId: setup.id,
        });
        return setup;
      },
    );
    if (prepared.state === "creating") await this.dispatcher.run(prepared.id);
    return this.get(actor, scope, id, prepared.id);
  }
  private continuation(setup: ConnectionSetupRecord) {
    const url =
      setup.state === "pending" && setup.sealedUrl
        ? this.protection.open(setup.id, setup.sealedUrl)
        : null;
    if (url !== null && typeof url !== "string")
      throw Error("Invalid encrypted setup continuation.");
    return { setup: setupView(setup), url };
  }

  get(
    actor: Principal,
    scope: ConnectorServerScope,
    connectionId: string,
    setupId: string,
  ) {
    return withAdministrator(
      this.repository,
      this.verifier,
      actor,
      scope,
      "installation-connections:write",
      async (store) => {
        await connection(store, scope, connectionId);
        await currentSetup(store, scope, connectionId);
        const setup = await store.setups.get(scope, setupId);
        if (!setup || setup.connectionId !== connectionId) missing();
        if (setup.initiatorId !== actor.user.id) denied();
        return this.continuation(setup);
      },
    );
  }
  cancel(
    actor: Principal,
    scope: ConnectorServerScope,
    connectionId: string,
    setupId: string,
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
          { kind: "cancel_setup", connectionId, setupId, revision },
        );
        const record = await connection(store, scope, connectionId);
        const setup = await store.setups.get(scope, setupId);
        if (!setup || setup.connectionId !== connectionId) missing();
        if (previous) return setupView(setup);
        checkConnectionRevision(record, revision);
        if (setup.state === "succeeded")
          throw new ConnectionError(
            "connection_unavailable",
            "This setup is complete. Disconnect the account instead.",
          );
        const updated = await cancelSetup(store, setup, "cancelled");
        await store.connections.save({
          ...record,
          revision: record.revision + 1,
          updatedAt: now(),
        });
        await store.connections.saveCommand(scope, {
          actorId: actor.user.id,
          key,
          fingerprint,
          resourceId: setupId,
        });
        return setupView(updated);
      },
    );
  }
  verify(actor: Principal, sessionRef: string) {
    return this.callbacks.verify(actor, sessionRef);
  }
}
