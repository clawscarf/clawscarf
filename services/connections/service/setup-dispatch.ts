import type { ConnectorAdministratorVerifier } from "../types/authority.js";
import { randomUUID } from "node:crypto";
import { missing } from "../shared/errors.js";
import type { Principal } from "../types/authority.js";
import type { ConnectorCatalog } from "../types/catalog.js";
import type {
  ConnectionAccountRecord,
  ConnectionSetupRecord,
} from "../types/model.js";
import type {
  ConnectionProtection,
  ConnectionRepository,
} from "../types/ports.js";
import {
  ConnectorProviderError,
  type ConnectorProvider,
} from "../types/provider.js";
import { ConnectionError } from "../types/errors.js";
import { requirePublishedCatalog } from "./catalog-publication.js";
import {
  cancelSetup,
  connection,
  currentSetup,
  now,
  unresolvedSetupEffect,
  withAdministrator,
} from "./state.js";

type Attempt = { phase: "preparation" | "allocation"; dispatchedAt: string };

/** Durable claims precede each distinct provider effect; redelivery cannot repeat either one. */
export class ConnectionSetupDispatcher {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly verifier: ConnectorAdministratorVerifier,
    private readonly catalog: ConnectorCatalog,
    private readonly protection: ConnectionProtection,
    private readonly provider: ConnectorProvider,
    private readonly projectId: string,
    private readonly callbackUrl: string,
  ) {}

  async run(setupId: string) {
    const prepared = await this.repository.transaction(async (store) => {
      const setup = await store.setups.byId(setupId);
      if (!setup) return null;
      await store.authority.lock(setup);
      const current = await currentSetup(store, setup, setup.connectionId);
      if (current?.id !== setup.id || current.state !== "creating") return null;
      // Redelivery observes claimed effects. Cancellation, expiry and effect failures own uncertainty.
      if (current.allocationDispatchedAt !== null) return null;
      if (
        current.preparationDispatchedAt !== null &&
        current.preparedAuth === null
      )
        return null;
      const actor = await store.authority.resolveActor(current.actor);
      if (!actor) {
        await cancelSetup(store, current, "cancelled");
        return null;
      }
      return { setup: current, actor };
    });
    if (prepared) await this.dispatch(prepared.actor, prepared.setup);
  }

  private async dispatch(actor: Principal, setup: ConnectionSetupRecord) {
    let attempt: Attempt | null = null;
    let observed = setup;
    try {
      const preparation = await withAdministrator(
        this.repository,
        this.verifier,
        actor,
        setup,
        "installation-connections:write",
        async (store) => {
          const current = await currentSetup(store, setup, setup.connectionId);
          if (
            current?.id !== setup.id ||
            current.state !== "creating" ||
            current.allocationDispatchedAt !== null
          )
            return null;
          if (
            current.preparationDispatchedAt !== null &&
            current.preparedAuth === null
          )
            return null;
          this.requireProject(current);
          const record = await connection(store, setup, setup.connectionId);
          await requirePublishedCatalog(
            store.catalogPublication,
            this.catalog,
            record.connectorId,
          );
          const connector = this.catalog.binding(record.connectorId);
          if (!connector) throw catalogChanged();
          if (current.preparedAuth) {
            this.requirePreparation(current, connector.toolkit);
            return { setup: current, connector, dispatch: false };
          }
          const claimed: ConnectionSetupRecord = {
            ...current,
            preparationDispatchedAt: now(),
            preparationCatalogVersion: this.catalog.version,
          };
          await store.setups.save(claimed);
          return { setup: claimed, connector, dispatch: true };
        },
      );
      if (!preparation) return;
      observed = preparation.setup;
      if (preparation.dispatch) {
        const dispatchedAt = preparation.setup.preparationDispatchedAt;
        if (dispatchedAt === null)
          throw Error("Preparation claim is missing its dispatch marker.");
        attempt = { phase: "preparation", dispatchedAt };
        const auth = await this.provider.resolveAuthConfiguration(
          preparation.connector,
          AbortSignal.timeout(60_000),
        );
        if (auth.toolkit !== preparation.connector.toolkit) {
          throw new ConnectorProviderError(
            "connector_provider_invalid_response",
            "The authentication configuration does not match this connector.",
            "outcome_unknown",
          );
        }
        observed = await this.repository.transaction(async (store) => {
          await store.authority.lock(setup);
          const current = await store.setups.get(setup, setup.id);
          if (!current) missing();
          if (
            current.preparationDispatchedAt !== dispatchedAt ||
            current.preparationCatalogVersion !== this.catalog.version ||
            current.preparedAuth !== null
          )
            throw Error(
              "Preparation receipt does not match its claimed intent.",
            );
          // Preserve a late receipt even after cancellation; it never authorizes account allocation itself.
          const eligible = await store.authority.setupEligible(
            setup,
            setup.initiatorId,
            setup.sessionHash,
          );
          const cancelled =
            !eligible && current.allocationDispatchedAt === null;
          const retained: ConnectionSetupRecord = {
            ...current,
            preparedAuth: { id: auth.id, toolkit: auth.toolkit },
            state: cancelled ? "cancelled" : current.state,
            completedAt: cancelled ? now() : current.completedAt,
          };
          await store.setups.save(retained);
          return retained;
        });
        attempt = null;
      }
      const allocation = await withAdministrator(
        this.repository,
        this.verifier,
        actor,
        setup,
        "installation-connections:write",
        async (store) => {
          const current = await currentSetup(store, setup, setup.connectionId);
          if (
            current?.id !== setup.id ||
            current.state !== "creating" ||
            current.allocationDispatchedAt !== null
          )
            return null;
          this.requireProject(current);
          const record = await connection(store, setup, setup.connectionId);
          await requirePublishedCatalog(
            store.catalogPublication,
            this.catalog,
            record.connectorId,
          );
          const connector = this.catalog.binding(record.connectorId);
          if (!connector) throw catalogChanged();
          const auth = this.requirePreparation(current, connector.toolkit);
          const dispatchedAt = now();
          await store.setups.save({
            ...current,
            allocationDispatchedAt: dispatchedAt,
          });
          return { auth, dispatchedAt };
        },
      );
      if (!allocation) return;
      attempt = { phase: "allocation", dispatchedAt: allocation.dispatchedAt };
      const created = await this.provider.createSetup(
        {
          authConfigurationId: allocation.auth.id,
          subjectId: setup.subjectId,
          callbackUrl: this.callbackUrl,
        },
        AbortSignal.timeout(30_000),
      );
      await this.repository.transaction(async (store) => {
        await store.authority.lock(setup);
        const current = await store.setups.get(setup, setup.id);
        if (!current) missing();
        const eligible = await store.authority.setupEligible(
          setup,
          setup.initiatorId,
          setup.sessionHash,
        );
        const active =
          current.state === "creating" &&
          eligible &&
          Date.parse(current.expiresAt) > Date.now();
        const account: ConnectionAccountRecord = {
          serverId: setup.serverId,
          connectionId: setup.connectionId,
          projectId: setup.projectId,
          id: randomUUID(),
          setupId: setup.id,
          binding: {
            accountId: created.accountId,
            subjectId: setup.subjectId,
            toolkit: allocation.auth.toolkit,
            authConfigurationId: allocation.auth.id,
          },
          state: active ? "candidate" : "cleanup",
          cleanup: active ? "none" : "pending",
          revocationJobId: null,
          failure: null,
          nextAttemptAt: active ? null : now(),
        };
        await store.accounts.save(account);
        await store.setups.save({
          ...current,
          accountId: account.id,
          state: active ? "pending" : "cancelled",
          sealedUrl: active
            ? this.protection.seal(setup.id, created.connectUrl)
            : null,
          expiresAt: new Date(
            Math.min(
              Date.parse(current.expiresAt),
              Date.parse(created.expiresAt),
            ),
          ).toISOString(),
          completedAt: active ? null : now(),
        });
      });
    } catch (error) {
      await this.recordFailure(observed, attempt, error);
      if (!(error instanceof ConnectorProviderError)) throw error;
    }
  }

  private requireProject(setup: ConnectionSetupRecord) {
    if (setup.projectId !== this.projectId)
      throw new ConnectionError(
        "connection_unavailable",
        "This setup's provider project is unavailable.",
      );
  }
  private requirePreparation(setup: ConnectionSetupRecord, toolkit: string) {
    if (
      !setup.preparedAuth ||
      setup.preparationCatalogVersion !== this.catalog.version ||
      setup.preparedAuth.toolkit !== toolkit
    )
      throw catalogChanged();
    return setup.preparedAuth;
  }
  private async recordFailure(
    setup: ConnectionSetupRecord,
    attempt: Attempt | null,
    error: unknown,
  ) {
    await this.repository.transaction(async (store) => {
      await store.authority.lock(setup);
      const current = await store.setups.get(setup, setup.id);
      if (
        !current ||
        !["creating", "cancelled", "expired", "outcome_unknown"].includes(
          current.state,
        )
      )
        return;
      if (
        !attempt &&
        (current.state !== "creating" || unresolvedSetupEffect(current))
      )
        return;
      if (!attempt) {
        if (
          current.preparationDispatchedAt !== setup.preparationDispatchedAt ||
          current.preparedAuth?.id !== setup.preparedAuth?.id ||
          current.preparedAuth?.toolkit !== setup.preparedAuth?.toolkit
        )
          return;
        // An outdated request cannot fail work now owned by the published deployment.
        // Outcomes of a dispatched provider effect bypass this fence and are always retained.
        const published = await store.catalogPublication.lock("shared");
        if (published?.version !== this.catalog.version) return;
      }
      if (
        attempt &&
        (attempt.phase === "preparation"
          ? current.preparationDispatchedAt
          : current.allocationDispatchedAt) !== attempt.dispatchedAt
      )
        return;
      const failure =
        error instanceof ConnectorProviderError ? error.failure() : null;
      const definitive =
        failure !== null && failure.completion !== "outcome_unknown";
      const updated: ConnectionSetupRecord = {
        ...current,
        ...(definitive &&
        attempt?.phase === "preparation" &&
        current.preparedAuth === null
          ? { preparationDispatchedAt: null, preparationCatalogVersion: null }
          : {}),
        ...(definitive &&
        attempt?.phase === "allocation" &&
        current.accountId === null
          ? { allocationDispatchedAt: null }
          : {}),
        completedAt: now(),
        failure,
        sealedUrl: null,
      };
      updated.state = unresolvedSetupEffect(updated)
        ? "outcome_unknown"
        : current.state === "creating" || current.state === "outcome_unknown"
          ? "failed"
          : current.state;
      await store.setups.save(updated);
    });
  }
}

function catalogChanged() {
  return new ConnectionError(
    "connector_catalog_changed",
    "This setup's catalog changed. Start a new setup using the current catalog.",
  );
}
