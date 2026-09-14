import type { ConnectionRepository } from "../types/ports.js";
import {
  ConnectorProviderError,
  type ConnectorProvider,
} from "../types/provider.js";
import { cancelSetup, now, unresolvedSetupEffect } from "./state.js";

/** System cleanup has its own retained ownership records and never impersonates an agent. */
export class ConnectionMaintenanceService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly provider: ConnectorProvider,
    private readonly projectId: string,
  ) {}
  async sweep(signal?: AbortSignal) {
    if (signal?.aborted) return;
    const due = await this.repository.transaction(async (store) => {
      await store.invocations.expireDispatches();
      return {
        setups: await store.setups.due(100),
        accounts: await store.accounts.due(100),
      };
    });
    for (const setup of due.setups) {
      if (signal?.aborted) return;
      await this.repository.transaction(async (store) => {
        await store.authority.lock(setup);
        const current = await store.setups.get(setup, setup.id);
        if (!current || Date.parse(current.expiresAt) > Date.now()) return;
        if (
          (current.state === "creating" && unresolvedSetupEffect(current)) ||
          current.state === "verifying"
        )
          await store.setups.save({
            ...current,
            state: "outcome_unknown",
            sealedUrl: null,
            completedAt: now(),
          });
        else if (current.state === "pending" || current.state === "creating")
          await cancelSetup(store, current, "expired");
      });
    }
    for (const account of due.accounts) {
      if (signal?.aborted) return;
      const claim = await this.repository.transaction(async (store) => {
        await store.authority.lock(account);
        const current = await store.accounts.get(account, account.id);
        if (
          !current ||
          current.state !== "cleanup" ||
          !["pending", "running"].includes(current.cleanup) ||
          !current.nextAttemptAt ||
          Date.parse(current.nextAttemptAt) > Date.now()
        )
          return null;
        if (current.projectId !== this.projectId) {
          await store.accounts.save({
            ...current,
            cleanup: "needs_attention",
            nextAttemptAt: null,
          });
          return null;
        }
        const claimed = {
          ...current,
          cleanup: "running" as const,
          nextAttemptAt: new Date(Date.now() + 120_000).toISOString(),
        };
        await store.accounts.save(claimed);
        return claimed;
      });
      if (!claim) continue;
      try {
        const outcome = await this.provider.deleteAccount(
          claim.binding,
          signal
            ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
            : AbortSignal.timeout(30_000),
        );
        await this.repository.transaction(async (store) => {
          await store.authority.lock(claim);
          const current = await store.accounts.get(claim, claim.id);
          if (
            current?.cleanup !== "running" ||
            current.nextAttemptAt !== claim.nextAttemptAt
          )
            return;
          // Complete means the hosted account is absent; provider background token revocation may still be running.
          await store.accounts.save({
            ...current,
            cleanup: "complete",
            nextAttemptAt: null,
            failure: null,
            revocationJobId: outcome.revocationJobId,
          });
        });
      } catch (error) {
        await this.repository.transaction(async (store) => {
          await store.authority.lock(claim);
          const current = await store.accounts.get(claim, claim.id);
          if (
            current?.cleanup !== "running" ||
            current.nextAttemptAt !== claim.nextAttemptAt
          )
            return;
          const retry =
            error instanceof ConnectorProviderError &&
            (error.retry.strategy === "after_delay" ||
              error.retry.strategy === "reconcile");
          await store.accounts.save({
            ...current,
            cleanup: retry ? "pending" : "needs_attention",
            nextAttemptAt: retry
              ? new Date(Date.now() + 60_000).toISOString()
              : null,
            failure:
              error instanceof ConnectorProviderError ? error.failure() : null,
          });
        });
        if (!(error instanceof ConnectorProviderError)) throw error;
      }
    }
  }
}
