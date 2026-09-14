import { ConnectionError } from "../types/errors.js";
import { denied } from "../shared/errors.js";
import type {
  ConnectionProtection,
  ConnectionRepository,
  ConnectionTransaction,
} from "../types/ports.js";
import type { ConnectorRuntimePrincipal } from "../types/runtime-auth.js";
import type { ConnectorCallContext } from "../types/model.js";
import { connection } from "./state.js";

export function connectorCallCorrelation(
  protection: ConnectionProtection,
  principal: ConnectorRuntimePrincipal,
  context: ConnectorCallContext,
) {
  return protection.fingerprint(principal.serverId, {
    agentId: context.agentId,
    sessionId: context.sessionId ?? null,
    sessionKey: context.sessionKey ?? null,
    toolCallId: context.toolCallId,
  });
}

export async function usableRuntimeConnection(
  store: ConnectionTransaction,
  principal: ConnectorRuntimePrincipal,
  agentId: string,
  id: string,
  generation?: number,
) {
  await currentConnectorRuntime(store, principal);
  const row = await connection(store, principal, id);
  if (
    row.state !== "connected" ||
    !row.activeAccountId ||
    (row.grant.mode === "selected" && !row.grant.agentIds.includes(agentId))
  )
    denied();
  if (generation !== undefined && row.generation !== generation)
    throw new ConnectionError(
      "connection_unavailable",
      "This account changed. Describe the connection again before calling it.",
    );
  return row;
}

export async function currentConnectorRuntime(
  store: ConnectionTransaction,
  principal: ConnectorRuntimePrincipal,
) {
  await store.authority.lock(principal);
  const current = await store.credentials.current(principal);
  if (
    !current ||
    current.state !== "active" ||
    current.credentialId !== principal.credentialId ||
    current.credentialGeneration !== principal.credentialGeneration
  )
    throw new ConnectionError(
      "connector_credential_revoked",
      "Installation connection access was revoked.",
    );
  await store.authority.runtime(principal);
  return current;
}
export class ConnectorCredentialService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly protection: ConnectionProtection,
  ) {}
  async authenticate(token: string): Promise<ConnectorRuntimePrincipal> {
    const hash = this.protection.hashCredential(token);
    return this.repository.transaction(async (store) => {
      const credential = await store.credentials.byHash(hash);
      if (!credential)
        throw new ConnectionError(
          "connector_credential_revoked",
          "Installation connection access is unavailable.",
        );
      await currentConnectorRuntime(store, credential);
      return {
        credentialId: credential.credentialId,
        credentialGeneration: credential.credentialGeneration,
        serverId: credential.serverId,
      };
    });
  }
}
