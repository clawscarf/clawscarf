import type { ConnectorProviderFailure } from "../types/provider.js";
import type {
  ConnectionRecord,
  ConnectionSetupRecord,
  ConnectionInvocationRecord,
} from "../types/model.js";
import type { ConnectionTransaction } from "../types/ports.js";
import { currentSetup } from "./state.js";
export function connectionFailure(failure: ConnectorProviderFailure | null) {
  if (!failure) return null;
  const code =
    failure.completion === "outcome_unknown"
      ? "outcome_unknown"
      : failure.code === "connector_account_mismatch"
        ? "account_mismatch"
        : failure.code === "connector_provider_rejected" ||
            failure.code === "connector_provider_request_invalid"
          ? "provider_rejected"
          : "provider_unavailable";
  return { code, detail: failure.message, retry: failure.retry } as const;
}
export function setupView(s: ConnectionSetupRecord) {
  return {
    id: s.id,
    connectionId: s.connectionId,
    kind: s.kind,
    state: s.state,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    completedAt: s.completedAt,
    failure: connectionFailure(s.failure),
  } as const;
}
export async function connectionView(
  store: ConnectionTransaction,
  r: ConnectionRecord,
) {
  const setup = await currentSetup(store, r, r.id);
  const accounts = await store.accounts.forConnection(r, r.id);
  const cleanup = accounts.some((a) => a.cleanup === "needs_attention")
    ? "needs_attention"
    : accounts.some((a) => a.cleanup === "pending" || a.cleanup === "running")
      ? "pending"
      : accounts.some((a) => a.cleanup === "complete")
        ? "complete"
        : "none";
  return {
    id: r.id,
    serverId: r.serverId,
    connectorId: r.connectorId,
    name: r.name,
    grant: r.grant,
    state: r.state,
    generation: r.generation,
    revision: r.revision,
    setup: setup ? setupView(setup) : null,
    cleanup,
    failure: connectionFailure(r.failure),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  } as const;
}
export function invocationView(r: ConnectionInvocationRecord) {
  return {
    id: r.id,
    connectionId: r.connectionId,
    generation: r.generation,
    agentId: r.agentId,
    actionId: r.actionId,
    version: r.version,
    state: r.state,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    failure: connectionFailure(r.failure),
  } as const;
}
