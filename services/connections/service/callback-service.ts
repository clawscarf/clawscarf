import {
  denied,
  isDomainError,
  missing,
  type DomainError,
} from "../shared/errors.js";
import type { Principal } from "../types/authority.js";
import type {
  ConnectorAdministratorVerifier,
  ConnectorServerScope,
} from "../types/authority.js";
import type { CallbackRecord } from "../types/callbacks.js";
import type {
  ConnectionAccountRecord,
  ConnectionRecord,
  ConnectionSetupRecord,
} from "../types/model.js";
import type {
  ConnectionProtection,
  ConnectionRepository,
  ConnectionTransaction,
} from "../types/ports.js";
import type { ConnectorProvider } from "../types/provider.js";
import { requireConnectionGrant } from "../types/validation.js";
import { ConnectionError } from "../types/errors.js";
import {
  checkConnectionRevision,
  connection,
  currentSetup,
  now,
  withAdministrator,
} from "./state.js";

interface Confirmation {
  callback: CallbackRecord;
  setup: ConnectionSetupRecord;
  account: ConnectionAccountRecord;
  record: ConnectionRecord;
}

/** A provider identity receipt is evidence; every promotion still requires current authority. */
export class ConnectionCallbackService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly verifier: ConnectorAdministratorVerifier,
    private readonly protection: ConnectionProtection,
    private readonly provider: ConnectorProvider,
    private readonly projectId: string,
  ) {}

  async verify(actor: Principal, sessionRef: string) {
    if (!sessionRef || sessionRef.length > 8192) denied();
    const hash = this.protection.fingerprint("connector-callback", sessionRef);
    const existing = await this.repository.transaction((store) =>
      store.callbacks.get(hash, actor.user.id),
    );
    if (existing) return this.resumeCallback(actor, existing);
    const claimed = await this.claimAuthorized(actor, hash);
    if (!claimed) {
      const current = await this.repository.transaction((store) =>
        store.callbacks.get(hash, actor.user.id),
      );
      if (!current) callbackUsed();
      return this.resumeCallback(actor, current);
    }
    const subjectId = this.protection.subject(actor.user.id);
    const identity = await this.provider.completeIdentity(
      { sessionRef, subjectId },
      AbortSignal.timeout(30_000),
    );
    // Retain the one-use response before further Gateway or provider I/O, even after revocation.
    await this.repository.transaction((store) =>
      store.callbacks.retain(hash, actor.user.id, {
        projectId: this.projectId,
        subjectId,
        ...identity,
      }),
    );
    const confirmed = await this.repository.transaction((store) =>
      store.callbacks.get(hash, actor.user.id),
    );
    if (!confirmed) missing();
    return this.resumeCallback(actor, confirmed);
  }

  private async claimAuthorized(actor: Principal, hash: string) {
    const candidates = await this.repository.transaction((store) =>
      store.setups.pendingForUser(actor.user.id, this.projectId),
    );
    if (!candidates.length || candidates.length > 100) denied();
    let unavailable: DomainError | undefined;
    for (const candidate of candidates) {
      try {
        return await withAdministrator(
          this.repository,
          this.verifier,
          actor,
          candidate,
          "installation-connections:write",
          async (store) => {
            const setup = await currentSetup(
              store,
              candidate,
              candidate.connectionId,
            );
            if (setup?.id !== candidate.id || setup.state !== "pending")
              denied();
            return store.callbacks.claim(hash, actor.user.id);
          },
        );
      } catch (error) {
        if (!isDomainError(error)) throw error;
        if (error.category !== "forbidden" && error.category !== "not_found")
          unavailable ??= error;
      }
    }
    if (unavailable) throw unavailable;
    denied();
  }

  /** Called inside the authorized refresh reservation transaction. Unconfirmed setups cannot resume. */
  async prepareRefresh(
    store: ConnectionTransaction,
    actor: Principal,
    record: ConnectionRecord,
  ): Promise<Confirmation | null> {
    const setup = await currentSetup(store, record, record.id);
    if (
      !setup ||
      !["pending", "verifying"].includes(setup.state) ||
      setup.initiatorId !== actor.user.id ||
      !setup.accountId
    )
      return null;
    const account = await store.accounts.get(record, setup.accountId);
    if (!account || account.projectId !== this.projectId) return null;
    const callback = await store.callbacks.byAccount(
      actor.user.id,
      this.projectId,
      account.binding.accountId,
    );
    if (!callback) return null;
    return this.confirmation(store, actor, record, callback);
  }

  private async confirmation(
    store: ConnectionTransaction,
    actor: Principal,
    record: ConnectionRecord,
    callback: CallbackRecord,
  ): Promise<Confirmation> {
    const identity = callback.identity;
    if (
      !identity ||
      callback.userId !== actor.user.id ||
      identity.projectId !== this.projectId ||
      identity.subjectId !== this.protection.subject(actor.user.id)
    )
      denied();
    const setup = await currentSetup(store, record, record.id);
    if (
      !setup ||
      !["pending", "verifying"].includes(setup.state) ||
      setup.initiatorId !== actor.user.id ||
      setup.projectId !== identity.projectId ||
      setup.subjectId !== identity.subjectId ||
      !setup.accountId
    )
      denied();
    const account = await store.accounts.get(record, setup.accountId);
    if (
      !account ||
      account.state !== "candidate" ||
      account.cleanup !== "none" ||
      account.setupId !== setup.id ||
      account.connectionId !== record.id ||
      account.projectId !== identity.projectId ||
      account.binding.accountId !== identity.accountId ||
      account.binding.subjectId !== identity.subjectId ||
      account.binding.toolkit !== identity.toolkit
    )
      denied();
    return { callback, setup, account, record };
  }

  private async resumeCallback(actor: Principal, callback: CallbackRecord) {
    const identity = callback.identity;
    if (!identity) callbackUsed();
    if (
      identity.projectId !== this.projectId ||
      identity.subjectId !== this.protection.subject(actor.user.id)
    )
      denied();
    const account = await this.repository.transaction((store) =>
      store.accounts.byProvider(this.projectId, identity.accountId),
    );
    if (
      !account ||
      account.binding.subjectId !== identity.subjectId ||
      account.binding.toolkit !== identity.toolkit
    )
      denied();
    const prepared = await withAdministrator(
      this.repository,
      this.verifier,
      actor,
      account,
      "installation-connections:write",
      async (store) => {
        const record = await connection(store, account, account.connectionId);
        const current = await store.callbacks.get(callback.hash, actor.user.id);
        if (!current?.identity) callbackUsed();
        if (current.state === "complete") {
          if (current.connectionId !== record.id) denied();
          return { destination: destination(record) };
        }
        return {
          confirmation: await this.confirmation(store, actor, record, current),
        };
      },
    );
    if (prepared.destination) return prepared.destination;
    await this.finish(actor, prepared.confirmation);
    return destination(prepared.confirmation.record);
  }

  async finish(actor: Principal, prepared: Confirmation) {
    const observed = await this.provider.inspectAccount(
      prepared.account.binding,
      AbortSignal.timeout(30_000),
    );
    if (observed?.state !== "active")
      throw new ConnectionError(
        "connection_unavailable",
        "The account is not connected yet. Check its status before continuing.",
      );
    await withAdministrator(
      this.repository,
      this.verifier,
      actor,
      prepared.record,
      "installation-connections:write",
      async (store, proof) => {
        const record = await connection(
          store,
          prepared.record,
          prepared.record.id,
        );
        const callback = await store.callbacks.get(
          prepared.callback.hash,
          actor.user.id,
        );
        if (!callback?.identity) denied();
        // Another authorized completion may have won while this read was in flight.
        if (callback.state === "complete") {
          if (callback.connectionId !== record.id) denied();
          return;
        }
        checkConnectionRevision(record, prepared.record.revision);
        if (record.generation !== prepared.record.generation) denied();
        const current = await this.confirmation(store, actor, record, callback);
        if (
          current.setup.id !== prepared.setup.id ||
          current.account.id !== prepared.account.id ||
          current.setup.sessionHash !== prepared.setup.sessionHash
        )
          denied();
        requireConnectionGrant(record.grant, proof.agentIds);
        await promote(store, current.setup, current.account, record);
        await store.callbacks.complete(callback.hash, actor.user.id, record.id);
      },
    );
  }
}

function destination(
  record: ConnectionRecord,
): ConnectorServerScope & { connectionId: string } {
  return {
    serverId: record.serverId,
    connectionId: record.id,
  };
}
function callbackUsed(): never {
  throw new ConnectionError(
    "connection_callback_used",
    "This connection could not be confirmed. Check its status before starting a new setup.",
  );
}

async function promote(
  store: ConnectionTransaction,
  setup: ConnectionSetupRecord,
  account: ConnectionAccountRecord,
  record: ConnectionRecord,
) {
  if (record.activeAccountId) {
    const previous = await store.accounts.get(setup, record.activeAccountId);
    if (!previous) missing();
    await store.accounts.save({
      ...previous,
      state: "cleanup",
      cleanup: "pending",
      nextAttemptAt: now(),
    });
  }
  await store.accounts.save({ ...account, state: "active" });
  await store.connections.save({
    ...record,
    state: "connected",
    activeAccountId: account.id,
    generation: record.generation + 1,
    revision: record.revision + 1,
    failure: null,
    updatedAt: now(),
  });
  await store.setups.save({
    ...setup,
    state: "succeeded",
    sealedUrl: null,
    completedAt: now(),
  });
}
