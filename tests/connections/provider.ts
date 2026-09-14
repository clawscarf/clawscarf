import { randomUUID } from "node:crypto";
import type {
  ConnectorProvider,
  ConnectorProviderAccount,
  ConnectorProviderBinding,
  ConnectorProviderExecution,
} from "../../services/connections/types/provider.js";
export class ConnectionProviderFixture implements ConnectorProvider {
  accounts = new Map<string, ConnectorProviderAccount>();
  setupCalls = 0;
  executeCalls = 0;
  identityCalls = 0;
  deleteCalls = 0;
  identityAccount: string | null = null;
  beforeExecute: (() => Promise<void>) | null = null;
  beforeInspect: (() => Promise<void>) | null = null;
  beforeSetup: (() => Promise<void>) | null = null;
  executeResult: ConnectorProviderExecution = {
    status: "succeeded",
    result: { kind: "inline", data: { ok: true } },
  };
  resolveAuthConfiguration(
    input: Parameters<ConnectorProvider["resolveAuthConfiguration"]>[0],
  ) {
    return Promise.resolve({ id: "auth-test", ...input });
  }
  async createSetup(input: Parameters<ConnectorProvider["createSetup"]>[0]) {
    this.setupCalls++;
    const id = "account-" + randomUUID();
    this.accounts.set(id, {
      binding: {
        accountId: id,
        subjectId: input.subjectId,
        toolkit: "test",
        authConfigurationId: input.authConfigurationId,
      },
      label: null,
      state: "pending",
    });
    await this.beforeSetup?.();
    return {
      accountId: id,
      connectUrl: "https://connect.example.test/secret-" + id,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
  }
  completeIdentity(
    input: Parameters<ConnectorProvider["completeIdentity"]>[0],
  ) {
    this.identityCalls++;
    const account = this.accounts.get(this.identityAccount ?? "");
    if (!account || account.binding.subjectId !== input.subjectId)
      throw Error("Fixture identity mismatch");
    account.state = "active";
    return Promise.resolve({
      accountId: account.binding.accountId,
      toolkit: account.binding.toolkit,
    });
  }
  async inspectAccount(binding: ConnectorProviderBinding) {
    await this.beforeInspect?.();
    return this.accounts.get(binding.accountId) ?? null;
  }
  deleteAccount(binding: ConnectorProviderBinding) {
    this.deleteCalls++;
    this.accounts.delete(binding.accountId);
    return Promise.resolve({
      status: "deleted" as const,
      revocationJobId: null,
    });
  }
  async execute() {
    this.executeCalls++;
    await this.beforeExecute?.();
    return this.executeResult;
  }
}
