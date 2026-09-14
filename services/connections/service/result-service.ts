import { denied, missing } from "../shared/errors.js";
import type {
  ConnectorCallContext,
  ConnectionInvocationRecord,
  ConnectionInvocationResult,
} from "../types/model.js";
import type {
  ConnectionRepository,
  ConnectionProtection,
  ConnectionTransaction,
} from "../types/ports.js";
import type { ConnectorRuntimePrincipal } from "../types/runtime-auth.js";
import { requireConnectorContext } from "../types/validation.js";
import {
  connectorCallCorrelation,
  currentConnectorRuntime,
  usableRuntimeConnection,
} from "./runtime-auth.js";
import { invocationView } from "./views.js";
import { readInvocationPayload } from "./result-payload.js";
import { resultPage } from "./result-pages.js";

/** Receipt and payload reads have no provider capability and never dispatch an action. */
export class ConnectorResultService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly protection: ConnectionProtection,
  ) {}
  private async authorize(
    store: ConnectionTransaction,
    principal: ConnectorRuntimePrincipal,
    agentId: string,
    record: ConnectionInvocationRecord,
  ) {
    if (
      !agentId ||
      agentId.length > 160 ||
      record.serverId !== principal.serverId ||
      record.credentialId !== principal.credentialId ||
      record.credentialGeneration !== principal.credentialGeneration ||
      record.agentId !== agentId
    )
      denied();
    await usableRuntimeConnection(
      store,
      principal,
      agentId,
      record.connectionId,
      record.generation,
    );
  }
  async receipt(
    store: ConnectionTransaction,
    principal: ConnectorRuntimePrincipal,
    agentId: string,
    record: ConnectionInvocationRecord,
  ) {
    await this.authorize(store, principal, agentId, record);
    const payload = readInvocationPayload(record, this.protection);
    const result: ConnectionInvocationResult =
      payload.kind === "unavailable"
        ? payload
        : payload.inline
          ? { kind: "inline", data: payload.inline.data }
          : payload.reference;
    return { invocation: invocationView(record), result };
  }
  async getInvocation(
    principal: ConnectorRuntimePrincipal,
    agentId: string,
    id: string,
  ) {
    return this.repository.transaction(async (store) => {
      await currentConnectorRuntime(store, principal);
      const record = await store.invocations.get(principal, id);
      if (!record) missing();
      return this.receipt(store, principal, agentId, record);
    });
  }
  async lookup(
    principal: ConnectorRuntimePrincipal,
    context: ConnectorCallContext,
    targetToolCallId: string,
  ) {
    requireConnectorContext(context, true);
    const original = { ...context, toolCallId: targetToolCallId };
    requireConnectorContext(original, true);
    return this.repository.transaction(async (store) => {
      await currentConnectorRuntime(store, principal);
      const record = await store.invocations.byCorrelation(
        principal,
        connectorCallCorrelation(this.protection, principal, original),
      );
      if (!record) missing();
      return this.receipt(store, principal, context.agentId, record);
    });
  }
  async page(
    principal: ConnectorRuntimePrincipal,
    agentId: string,
    id: string,
    cursor?: string,
  ) {
    return this.repository.transaction(async (store) => {
      await currentConnectorRuntime(store, principal);
      const record = await store.invocations.get(principal, id);
      if (!record) missing();
      await this.authorize(store, principal, agentId, record);
      const payload = readInvocationPayload(record, this.protection);
      return {
        invocation: invocationView(record),
        result:
          payload.kind === "unavailable"
            ? payload
            : await resultPage({
                payload,
                principal,
                agentId,
                protection: this.protection,
                invocations: store.invocations,
                ...(cursor === undefined ? {} : { cursor }),
              }),
      };
    });
  }
}
