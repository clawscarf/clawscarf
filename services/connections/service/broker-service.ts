import { randomUUID } from "node:crypto";
import { CommonError, denied, missing } from "../shared/errors.js";
import type {
  ConnectorCatalog,
  ConnectorCatalogQuery,
} from "../types/catalog.js";
import type { ConnectorRuntimePrincipal } from "../types/runtime-auth.js";
import type {
  ConnectorCallContext,
  ConnectionRecord,
  ConnectionInvocationRecord,
} from "../types/model.js";
import type {
  ConnectionProtection,
  ConnectionRepository,
  ConnectionTransaction,
} from "../types/ports.js";
import {
  ConnectorProviderError,
  type ConnectorProvider,
} from "../types/provider.js";
import { ConnectionError } from "../types/errors.js";
import {
  requireConnectorContext,
  requireConnectorJson,
} from "../types/validation.js";
import {
  currentConnectorRuntime,
  connectorCallCorrelation,
  usableRuntimeConnection,
} from "./runtime-auth.js";
import { now } from "./state.js";
import { ConnectorResultService } from "./result-service.js";
import { sealInvocationPayload } from "./result-payload.js";
import { searchConnections } from "./search.js";
import { requirePublishedCatalog } from "./catalog-publication.js";

interface RuntimeCall {
  context: ConnectorCallContext;
  connectionId: string;
  generation: number;
  actionId: string;
  version: string;
  arguments: unknown;
}
export class ConnectorBrokerService {
  private readonly results: ConnectorResultService;
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly catalog: ConnectorCatalog,
    private readonly protection: ConnectionProtection,
    private readonly provider: ConnectorProvider,
    private readonly projectId: string,
    private readonly portalOrigin: string,
  ) {
    this.results = new ConnectorResultService(repository, protection);
  }
  async search(
    principal: ConnectorRuntimePrincipal,
    context: ConnectorCallContext,
    query: ConnectorCatalogQuery & {
      connectionId?: string;
      connectorId?: string;
    },
  ) {
    requireConnectorContext(context);
    return this.repository.transaction(async (store) => {
      await currentConnectorRuntime(store, principal);
      const rows = await store.connections.usable(principal, context.agentId);
      const page = searchConnections({
        catalog: this.catalog,
        connections: rows,
        query,
        protection: this.protection,
        binding: principal.serverId,
        authority: {
          credentialId: principal.credentialId,
          credentialGeneration: principal.credentialGeneration,
          agentId: context.agentId,
        },
      });
      return {
        ...page,
        guidance: rows.length
          ? null
          : {
              code: "no_usable_connections" as const,
              connectionsUrl: new URL(
                "/_clawscarf/connections/",
                this.portalOrigin,
              ).href,
            },
      };
    });
  }
  async describe(
    principal: ConnectorRuntimePrincipal,
    context: ConnectorCallContext,
    connectionId: string,
    actionId: string,
  ) {
    requireConnectorContext(context);
    const record = await this.repository.transaction(async (store) => {
      const current = await usableRuntimeConnection(
        store,
        principal,
        context.agentId,
        connectionId,
      );
      await this.requireAccount(store, principal, current);
      return current;
    });
    const action = await this.catalog.describe(record.connectorId, actionId);
    if (!action) missing();
    await this.repository.transaction(async (store) => {
      const current = await usableRuntimeConnection(
        store,
        principal,
        context.agentId,
        connectionId,
        record.generation,
      );
      await this.requireAccount(store, principal, current);
    });
    return { connectionId, generation: record.generation, action };
  }
  getInvocation(
    principal: ConnectorRuntimePrincipal,
    agentId: string,
    id: string,
  ) {
    return this.results.getInvocation(principal, agentId, id);
  }
  getResultPage(
    principal: ConnectorRuntimePrincipal,
    agentId: string,
    id: string,
    cursor?: string,
  ) {
    return this.results.page(principal, agentId, id, cursor);
  }
  lookupInvocation(
    principal: ConnectorRuntimePrincipal,
    context: ConnectorCallContext,
    targetToolCallId: string,
  ) {
    return this.results.lookup(principal, context, targetToolCallId);
  }
  async call(
    principal: ConnectorRuntimePrincipal,
    input: RuntimeCall,
    signal: AbortSignal,
  ) {
    requireConnectorContext(input.context, true);
    const args = requireConnectorJson(input.arguments);
    if (args === null || typeof args !== "object" || Array.isArray(args))
      throw new CommonError(
        "invalid_request",
        "Connection arguments must be an object.",
      );
    const correlation = connectorCallCorrelation(
      this.protection,
      principal,
      input.context,
    );
    const fingerprint = this.protection.fingerprint(principal.serverId, {
      connectionId: input.connectionId,
      generation: input.generation,
      actionId: input.actionId,
      version: input.version,
      arguments: args,
    });
    const previous = await this.repository.transaction(async (store) => {
      await usableRuntimeConnection(
        store,
        principal,
        input.context.agentId,
        input.connectionId,
        input.generation,
      );
      const previous = await store.invocations.byCorrelation(
        principal,
        correlation,
      );
      if (previous && previous.fingerprint !== fingerprint)
        throw new CommonError(
          "idempotency_conflict",
          "This native tool call already belongs to different arguments.",
        );
      return previous
        ? this.results.receipt(
            store,
            principal,
            input.context.agentId,
            previous,
          )
        : null;
    });
    if (previous) return previous;
    const description = await this.describe(
      principal,
      input.context,
      input.connectionId,
      input.actionId,
    );
    if (
      description.generation !== input.generation ||
      description.action.version !== input.version
    )
      throw new ConnectionError(
        "connector_catalog_changed",
        "Describe the current action before calling it.",
      );
    const account = await this.repository.transaction(async (store) => {
      const row = await usableRuntimeConnection(
        store,
        principal,
        input.context.agentId,
        input.connectionId,
        input.generation,
      );
      return this.requireAccount(store, principal, row);
    });
    const observed = await this.provider.inspectAccount(
      account.binding,
      signal,
    );
    if (observed?.state !== "active")
      throw new ConnectionError(
        "connection_unavailable",
        "Reconnect this account before using it.",
      );
    const claim = await this.repository.transaction(async (store) => {
      const row = await usableRuntimeConnection(
        store,
        principal,
        input.context.agentId,
        input.connectionId,
        input.generation,
      );
      if (row.activeAccountId !== account.id) denied();
      const previous = await store.invocations.byCorrelation(
        principal,
        correlation,
      );
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new CommonError(
            "idempotency_conflict",
            "This native tool call already belongs to different arguments.",
          );
        return { record: previous, dispatch: false };
      }
      if (signal.aborted)
        throw new ConnectorProviderError(
          "connector_provider_cancelled",
          "Connection call was cancelled before dispatch.",
          "not_started",
        );
      await requirePublishedCatalog(
        store.catalogPublication,
        this.catalog,
        row.connectorId,
      );
      await this.requireAccount(store, principal, row);
      const record: ConnectionInvocationRecord = {
        serverId: principal.serverId,
        id: randomUUID(),
        connectionId: input.connectionId,
        generation: input.generation,
        credentialId: principal.credentialId,
        credentialGeneration: principal.credentialGeneration,
        accountId: account.id,
        agentId: input.context.agentId,
        correlation,
        fingerprint,
        actionId: input.actionId,
        version: input.version,
        state: "dispatching",
        createdAt: now(),
        completedAt: null,
        failure: null,
        sealedResult: null,
        sealedResultManifest: null,
        resultUnavailable: "pending",
      };
      await store.invocations.save(record);
      return { record, dispatch: true };
    });
    if (!claim.dispatch)
      return this.repository.transaction((store) =>
        this.results.receipt(
          store,
          principal,
          input.context.agentId,
          claim.record,
        ),
      );
    let finished: ConnectionInvocationRecord;
    let pages: string[] = [];
    try {
      const outcome = await this.provider.execute(
        {
          binding: account.binding,
          actionId: input.actionId,
          version: input.version,
          arguments: args,
        },
        signal,
      );
      const payload =
        outcome.status === "succeeded" && outcome.result.kind === "inline"
          ? sealInvocationPayload(
              claim.record.id,
              outcome.result.data,
              this.protection,
            )
          : { sealedResult: null, sealedResultManifest: null, pages: [] };
      pages = payload.pages;
      finished = {
        ...claim.record,
        state: outcome.status,
        completedAt: now(),
        failure: outcome.status === "succeeded" ? null : outcome.failure,
        sealedResult: payload.sealedResult,
        sealedResultManifest: payload.sealedResultManifest,
        resultUnavailable:
          outcome.status === "succeeded"
            ? outcome.result.kind === "inline"
              ? null
              : "invalid_result"
            : outcome.status === "rejected"
              ? "failed"
              : "outcome_unknown",
      };
      if (
        finished.state === "succeeded" &&
        finished.sealedResult === null &&
        finished.sealedResultManifest === null
      )
        finished.resultUnavailable = "invalid_result";
    } catch (error) {
      const definitive =
        error instanceof ConnectorProviderError &&
        error.completion !== "outcome_unknown";
      finished = {
        ...claim.record,
        state: definitive ? "rejected" : "outcome_unknown",
        completedAt: now(),
        failure:
          error instanceof ConnectorProviderError ? error.failure() : null,
        resultUnavailable: definitive ? "failed" : "outcome_unknown",
      };
    }
    // Persist the provider receipt even if access was revoked while the request was in flight.
    await this.repository.transaction(async (store) => {
      await store.authority.lock(principal);
      await store.invocations.save(finished, pages);
    });
    return this.repository.transaction((store) =>
      this.results.receipt(store, principal, input.context.agentId, finished),
    );
  }

  private async requireAccount(
    store: ConnectionTransaction,
    principal: ConnectorRuntimePrincipal,
    connection: ConnectionRecord,
  ) {
    if (!connection.activeAccountId) denied();
    const account = await store.accounts.get(
      principal,
      connection.activeAccountId,
    );
    if (account?.state !== "active" || account.projectId !== this.projectId)
      denied();
    const binding = this.catalog.binding(connection.connectorId);
    if (!binding || binding.toolkit !== account.binding.toolkit)
      throw new ConnectionError(
        "connector_catalog_changed",
        "This account belongs to a different service configuration. Reconnect it before using current actions.",
      );
    return account;
  }
}
