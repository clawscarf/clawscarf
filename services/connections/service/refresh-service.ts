import type { Principal } from "../types/authority.js";
import type {
  ConnectorAdministratorVerifier,
  ConnectorServerScope,
} from "../types/authority.js";
import type {
  ConnectionProtection,
  ConnectionRepository,
} from "../types/ports.js";
import {
  ConnectorProviderError,
  type ConnectorProvider,
} from "../types/provider.js";
import { ConnectionError } from "../types/errors.js";
import {
  checkConnectionRevision,
  connection,
  now,
  priorCommand,
  withAdministrator,
} from "./state.js";
import { ConnectionCallbackService } from "./callback-service.js";
import { connectionView } from "./views.js";
export class ConnectionRefreshService {
  private readonly callbacks: ConnectionCallbackService;
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly verifier: ConnectorAdministratorVerifier,
    private readonly protection: ConnectionProtection,
    private readonly provider: ConnectorProvider,
    private readonly projectId: string,
  ) {
    this.callbacks = new ConnectionCallbackService(
      repository,
      verifier,
      protection,
      provider,
      projectId,
    );
  }
  async refresh(
    actor: Principal,
    scope: ConnectorServerScope,
    id: string,
    revision: number,
    key: string,
  ) {
    const prepared = await withAdministrator(
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
          { kind: "refresh", id, revision },
        );
        const record = await connection(store, scope, id);
        if (previous && record.revision !== revision + 1)
          return { account: null, record, confirmation: null };
        if (!previous) checkConnectionRevision(record, revision);
        const account = record.activeAccountId
          ? await store.accounts.get(scope, record.activeAccountId)
          : null;
        if (account && account.projectId !== this.projectId)
          throw new ConnectionError(
            "connection_unavailable",
            "This account's provider project is unavailable.",
          );
        const reserved = previous
          ? record
          : {
              ...record,
              revision: record.revision + 1,
              updatedAt: now(),
            };
        if (!previous) {
          await store.connections.saveCommand(scope, {
            actorId: actor.user.id,
            key,
            fingerprint,
            resourceId: id,
          });
          await store.connections.save(reserved);
        }
        const confirmation = await this.callbacks.prepareRefresh(
          store,
          actor,
          reserved,
        );
        return { account, record: reserved, confirmation };
      },
    );
    if (prepared.confirmation) {
      await this.callbacks.finish(actor, prepared.confirmation);
    } else if (prepared.account) {
      let state: "connected" | "needs_attention" = "needs_attention";
      let failure = null;
      try {
        const account = await this.provider.inspectAccount(
          prepared.account.binding,
          AbortSignal.timeout(30_000),
        );
        state = account?.state === "active" ? "connected" : "needs_attention";
      } catch (error) {
        if (!(error instanceof ConnectorProviderError)) throw error;
        failure = error.failure();
      }
      await withAdministrator(
        this.repository,
        this.verifier,
        actor,
        scope,
        "installation-connections:write",
        async (store) => {
          const current = await connection(store, scope, id);
          if (
            current.activeAccountId !== prepared.account?.id ||
            current.generation !== prepared.record.generation ||
            current.revision !== prepared.record.revision
          )
            return;
          await store.connections.save({
            ...current,
            state,
            failure,
            revision: current.revision + 1,
            updatedAt: now(),
          });
        },
      );
    }
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
}
