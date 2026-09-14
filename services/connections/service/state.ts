import { CommonError, missing } from "../shared/errors.js";
import type {
  ConnectorServerScope,
  ConnectorAdministratorVerifier,
  ConnectorAdministratorProof,
  ConnectorManagementPermission,
} from "../types/authority.js";
import type { Principal } from "../types/authority.js";
import type {
  ConnectionRecord,
  ConnectionSetupRecord,
} from "../types/model.js";
import type {
  ConnectionRepository,
  ConnectionTransaction,
  ConnectionProtection,
} from "../types/ports.js";
import type { ConnectorJson } from "../types/catalog.js";
import { requireConnectionKey } from "../types/validation.js";

export const now = () => new Date().toISOString();
export function checkConnectionRevision(
  record: ConnectionRecord,
  expected: number,
) {
  if (!Number.isSafeInteger(expected) || expected !== record.revision)
    throw new CommonError(
      "revision_conflict",
      "This connection changed. Refresh before applying your change.",
    );
}
export async function connection(
  store: ConnectionTransaction,
  scope: ConnectorServerScope,
  id: string,
) {
  const row = await store.connections.get(scope, id);
  if (!row) missing();
  return row;
}
export async function withAdministrator<T>(
  repository: ConnectionRepository,
  verifier: ConnectorAdministratorVerifier,
  actor: Principal,
  scope: ConnectorServerScope,
  permission: ConnectorManagementPermission,
  work: (
    store: ConnectionTransaction,
    proof: ConnectorAdministratorProof,
  ) => Promise<T>,
) {
  const proof = await verifier.verify(actor, scope);
  return repository.transaction(async (store) => {
    await store.authority.authorize(actor, scope, permission, proof);
    return work(store, proof);
  });
}
export async function priorCommand(
  store: ConnectionTransaction,
  protection: ConnectionProtection,
  actor: Principal,
  scope: ConnectorServerScope,
  key: string,
  input: ConnectorJson,
) {
  requireConnectionKey(key);
  const fingerprint = protection.fingerprint(scope.serverId, input);
  const previous = await store.connections.command(scope, actor.user.id, key);
  if (previous && previous.fingerprint !== fingerprint)
    throw new CommonError(
      "idempotency_conflict",
      "This idempotency key belongs to a different connection command.",
    );
  return { fingerprint, previous };
}
export const pendingSetup = (setup: ConnectionSetupRecord) =>
  ["creating", "pending", "verifying"].includes(setup.state);
export const unresolvedSetupEffect = (setup: ConnectionSetupRecord) =>
  (setup.preparationDispatchedAt !== null && setup.preparedAuth === null) ||
  (setup.allocationDispatchedAt !== null && setup.accountId === null);
export async function cancelSetup(
  store: ConnectionTransaction,
  setup: ConnectionSetupRecord,
  state: "expired" | "cancelled",
) {
  if (!pendingSetup(setup) && setup.state !== "outcome_unknown") return setup;
  const updated: ConnectionSetupRecord = {
    ...setup,
    state: unresolvedSetupEffect(setup) ? "outcome_unknown" : state,
    sealedUrl: null,
    completedAt: now(),
  };
  await store.setups.save(updated);
  if (setup.accountId) {
    const account = await store.accounts.get(setup, setup.accountId);
    if (account?.state === "candidate")
      await store.accounts.save({
        ...account,
        state: "cleanup",
        cleanup: "pending",
        nextAttemptAt: now(),
      });
  }
  return updated;
}
export async function currentSetup(
  store: ConnectionTransaction,
  scope: ConnectorServerScope,
  id: string,
) {
  const setup = await store.setups.latest(scope, id);
  if (!setup || !pendingSetup(setup)) return setup;
  if (Date.parse(setup.expiresAt) <= Date.now()) {
    return cancelSetup(store, setup, "expired");
  }
  if (
    !(await store.authority.setupEligible(
      setup,
      setup.initiatorId,
      setup.sessionHash,
    ))
  )
    return cancelSetup(store, setup, "cancelled");
  return setup;
}
