import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { EncryptedConnectionProtection } from "../../services/connections/providers/protection.js";
import { catalogPublication } from "../../services/connections/service/catalog-publication.js";
import { ConnectionSetupDispatcher } from "../../services/connections/service/setup-dispatch.js";
import type {
  ConnectionAccountRecord,
  ConnectionSetupRecord,
} from "../../services/connections/types/model.js";
import type {
  ConnectionRepository,
  ConnectionTransaction,
} from "../../services/connections/types/ports.js";
import { ConnectorProviderError } from "../../services/connections/types/provider.js";
import { connectionCatalog } from "./catalog.js";
import { ConnectionProviderFixture } from "./provider.js";

function fixture() {
  const catalog = connectionCatalog();
  const actor = { user: { id: "user" }, sessionHash: "session" };
  let setup: ConnectionSetupRecord = {
    serverId: "server",
    id: "setup",
    connectionId: "connection",
    initiatorId: actor.user.id,
    actor: { userId: actor.user.id, sessionHash: actor.sessionHash },
    sessionHash: actor.sessionHash,
    subjectId: "subject",
    projectId: "test",
    kind: "initial",
    state: "creating",
    accountId: null,
    sealedUrl: null,
    allocationDispatchedAt: null,
    preparationDispatchedAt: new Date().toISOString(),
    preparationCatalogVersion: catalog.version,
    preparedAuth: { id: "auth-test", toolkit: "test" },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    completedAt: null,
    failure: null,
  };
  const accounts: ConnectionAccountRecord[] = [];
  let eligible = true;
  const unused = (): never => {
    throw Error("Unexpected fixture store operation");
  };
  const store: ConnectionTransaction = {
    authority: {
      lock: () => Promise.resolve(),
      authorize: () => Promise.resolve(),
      resolveActor: () => Promise.resolve(actor),
      setupEligible: () => Promise.resolve(eligible),
      runtime: unused,
    },
    setups: {
      byId: () => Promise.resolve(setup),
      get: () => Promise.resolve(setup),
      latest: () => Promise.resolve(setup),
      save: (next) => {
        setup = next;
        return Promise.resolve();
      },
      pendingForUser: unused,
      due: unused,
    },
    connections: {
      get: () =>
        Promise.resolve({
          serverId: setup.serverId,
          id: setup.connectionId,
          connectorId: "test",
          name: "Test",
          grant: { mode: "all" },
          state: "not_connected",
          generation: 1,
          revision: 1,
          activeAccountId: null,
          failure: null,
          createdAt: setup.createdAt,
          updatedAt: setup.createdAt,
        }),
      list: unused,
      count: unused,
      usable: unused,
      save: unused,
      command: unused,
      saveCommand: unused,
    },
    accounts: {
      save: (account) => {
        accounts.push(account);
        return Promise.resolve();
      },
      get: unused,
      byProvider: unused,
      forConnection: unused,
      due: unused,
    },
    catalogPublication: {
      lock: () => Promise.resolve(catalogPublication(catalog)),
      current: unused,
      retirementBlockers: unused,
      replace: unused,
    },
    get callbacks() {
      return unused();
    },
    get returns() {
      return unused();
    },
    get credentials() {
      return unused();
    },
    get invocations() {
      return unused();
    },
  };
  // The production repository serializes setup transactions through its authority lock.
  let tail: Promise<unknown> = Promise.resolve();
  const repository: ConnectionRepository = {
    transaction: (work) => {
      const pending = tail.then(() => work(store));
      tail = pending.catch(() => undefined);
      return pending;
    },
  };
  const provider = new ConnectionProviderFixture();
  const verifier = {
    verify: () =>
      Promise.resolve({
        serverId: setup.serverId,
        userId: actor.user.id,
        sessionHash: actor.sessionHash,
        verifiedAt: new Date().toISOString(),
        agentIds: [],
      }),
  };
  const protection = new EncryptedConnectionProtection(
    randomBytes(32),
    "fixture",
  );
  const dispatcher = () =>
    new ConnectionSetupDispatcher(
      repository,
      verifier,
      catalog,
      protection,
      provider,
      "test",
      "https://example.test/callback",
    );
  return {
    dispatcher,
    provider,
    accounts,
    setup: () => setup,
    expire: () => {
      setup = {
        ...setup,
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      };
    },
    revoke: () => {
      eligible = false;
    },
  };
}

await test("concurrent allocation delivery observes the claim without cancelling its successful receipt", async () => {
  const f = fixture();
  const started = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  f.provider.beforeSetup = async () => {
    started.resolve();
    await resume.promise;
  };
  const original = f.dispatcher().run("setup");
  try {
    await started.promise;
    await f.dispatcher().run("setup");
    assert.equal(f.setup().state, "creating");
    assert.equal(f.setup().completedAt, null);
    assert.equal(f.provider.setupCalls, 1);
    assert.equal(f.accounts.length, 0);
    resume.resolve();
    await original;
    assert.equal(f.setup().state, "pending");
    assert.ok(f.setup().sealedUrl);
    assert.equal(f.accounts.length, 1);
    assert.equal(f.accounts[0]?.state, "candidate");
    assert.equal(f.accounts[0]?.cleanup, "none");
    await f.dispatcher().run("setup");
    assert.equal(f.provider.setupCalls, 1);
    assert.equal(f.provider.deleteCalls, 0);
  } finally {
    resume.resolve();
    await original;
  }
});

for (const invalidation of ["expire", "revoke"] as const) {
  await test(`allocation replay after ${invalidation} preserves uncertainty and cleans up the late account`, async () => {
    const f = fixture();
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    f.provider.beforeSetup = async () => {
      started.resolve();
      await resume.promise;
    };
    const original = f.dispatcher().run("setup");
    try {
      await started.promise;
      f[invalidation]();
      await f.dispatcher().run("setup");
      assert.equal(f.setup().state, "outcome_unknown");
      assert.equal(f.provider.setupCalls, 1);
      resume.resolve();
      await original;
      assert.equal(f.setup().state, "cancelled");
      assert.equal(f.setup().sealedUrl, null);
      assert.equal(f.accounts[0]?.state, "cleanup");
      assert.equal(f.accounts[0]?.cleanup, "pending");
    } finally {
      resume.resolve();
      await original;
    }
  });
}

await test("allocation failure remains uncertain across dispatcher reconstruction without redelivery", async () => {
  const f = fixture();
  f.provider.beforeSetup = () =>
    Promise.reject(
      new ConnectorProviderError(
        "connector_provider_unknown_outcome",
        "Fixture response lost",
        "outcome_unknown",
      ),
    );
  await f.dispatcher().run("setup");
  assert.equal(f.setup().state, "outcome_unknown");
  await f.dispatcher().run("setup");
  assert.equal(f.setup().state, "outcome_unknown");
  assert.equal(f.provider.setupCalls, 1);
});
