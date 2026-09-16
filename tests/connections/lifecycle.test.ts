import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConnectorProviderError } from "../../services/connections/types/provider.js";
import { createClient } from "../../services/connections/generated/client/client/index.js";
import { callConnectorRuntime } from "../../services/connections/generated/client/sdk.gen.js";
import { createConnectionsHttpFixture } from "./http.js";
import { connectionsLifecycleFixture } from "./lifecycle-fixture.js";

const databaseUrl = process.env.CLAWSCARF_CONNECTIONS_TEST_DATABASE_URL;

await test(
  "real REST accepts bounded connector arguments above 64 KiB and rejects oversize before dispatch",
  { skip: !databaseUrl },
  async () => {
    const f = await connectionsLifecycleFixture(databaseUrl!);
    const { app } = await createConnectionsHttpFixture(f.app, f.actor);
    try {
      const connection = await f.connect();
      const { credential } = await f.runtime();
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      const client = createClient({ baseUrl: address, auth: credential.token });
      const call = (size: number) =>
        callConnectorRuntime({
          client,
          body: {
            context: {
              agentId: "a",
              sessionId: "native-session",
              toolCallId: randomUUID(),
            },
            connectionId: connection.id,
            generation: connection.generation,
            actionId: "TEST_CALL",
            version: "20260910",
            arguments: { text: "a".repeat(size) },
          },
        });
      const accepted = await call(80 * 1024);
      assert.equal(
        accepted.response?.status,
        200,
        JSON.stringify(accepted.error),
      );
      assert.equal(accepted.data?.invocation.state, "succeeded");
      assert.equal(f.provider.executeCalls, 1);
      const oversizedArguments = await call(128 * 1024);
      assert.equal(oversizedArguments.response?.status, 400);
      assert.equal(f.provider.executeCalls, 1);
      const oversizedEnvelope = await call(256 * 1024);
      assert.equal(oversizedEnvelope.response?.status, 413);
      assert.equal(f.provider.executeCalls, 1);
    } finally {
      await app.close();
      await f.close();
    }
  },
);

await test(
  "repeating the same setup request during allocation preserves its original account and continuation",
  { skip: !databaseUrl },
  async () => {
    const f = await connectionsLifecycleFixture(databaseUrl!);
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let pending: ReturnType<typeof f.app.setups.start> | undefined;
    try {
      f.provider.beforeSetup = async () => {
        started.resolve();
        await resume.promise;
      };
      const connection = await f.create();
      const start = () =>
        f.app.setups.start(
          f.actor,
          f.scope,
          connection.id,
          connection.revision,
          "start",
          "initial",
        );
      pending = start();
      await started.promise;
      const replay = await start();
      assert.equal(replay.setup.state, "creating");
      assert.equal(replay.url, null);
      assert.equal(f.provider.setupCalls, 1);
      resume.resolve();
      const completed = await pending;
      assert.equal(completed.setup.id, replay.setup.id);
      assert.equal(completed.setup.state, "pending");
      assert.ok(completed.url);
      const repeated = await start();
      assert.deepEqual(repeated, completed);
      await f.app.maintenance.sweep();
      assert.equal(f.provider.setupCalls, 1);
      assert.equal(f.provider.deleteCalls, 0);
      assert.equal(f.provider.accounts.size, 1);
    } finally {
      resume.resolve();
      await pending?.catch(() => undefined);
      await f.close();
    }
  },
);

await test(
  "cancelled setup retains a late allocated account for cleanup and never exposes its continuation",
  { skip: !databaseUrl },
  async () => {
    const f = await connectionsLifecycleFixture(databaseUrl!);
    const started = Promise.withResolvers<void>(),
      resume = Promise.withResolvers<void>();
    let pending: Promise<unknown> | undefined;
    try {
      f.provider.beforeSetup = async () => {
        started.resolve();
        await resume.promise;
      };
      const connection = await f.create();
      pending = f.app.setups.start(
        f.actor,
        f.scope,
        connection.id,
        connection.revision,
        "start",
        "initial",
      );
      await started.promise;
      const current = await f.app.service.get(f.actor, f.scope, connection.id);
      assert.ok(current.setup);
      await f.app.setups.cancel(
        f.actor,
        f.scope,
        connection.id,
        current.setup.id,
        current.revision,
        "cancel",
      );
      resume.resolve();
      await pending;
      const cancelled = await f.app.setups.get(
        f.actor,
        f.scope,
        connection.id,
        current.setup.id,
      );
      assert.equal(cancelled.setup.state, "cancelled");
      assert.equal(cancelled.url, null);
      assert.equal(f.provider.setupCalls, 1);
      await f.app.maintenance.sweep();
      assert.equal(f.provider.accounts.size, 0);
      assert.equal(f.provider.deleteCalls, 1);
      await f.app.setups.start(
        f.actor,
        f.scope,
        connection.id,
        connection.revision,
        "start",
        "initial",
      );
      assert.equal(f.provider.setupCalls, 1);
    } finally {
      resume.resolve();
      await pending?.catch(() => undefined);
      await f.close();
    }
  },
);

await test(
  "lost allocation response remains uncertain after cancellation and cannot allocate again",
  { skip: !databaseUrl },
  async () => {
    const f = await connectionsLifecycleFixture(databaseUrl!);
    try {
      f.provider.beforeSetup = () =>
        Promise.reject(
          new ConnectorProviderError(
            "connector_provider_unknown_outcome",
            "Fixture response lost.",
            "outcome_unknown",
          ),
        );
      const connection = await f.create();
      const result = await f.app.setups.start(
        f.actor,
        f.scope,
        connection.id,
        connection.revision,
        "start",
        "initial",
      );
      assert.equal(result.setup.state, "outcome_unknown");
      assert.equal(result.url, null);
      const current = await f.app.service.get(f.actor, f.scope, connection.id);
      await f.app.setups.cancel(
        f.actor,
        f.scope,
        connection.id,
        result.setup.id,
        current.revision,
        "cancel",
      );
      const after = await f.app.service.get(f.actor, f.scope, connection.id);
      await assert.rejects(
        f.app.setups.start(
          f.actor,
          f.scope,
          connection.id,
          after.revision,
          "again",
          "initial",
        ),
        { code: "connection_setup_pending" },
      );
      await f.app.setups.start(
        f.actor,
        f.scope,
        connection.id,
        connection.revision,
        "start",
        "initial",
      );
      assert.equal(f.provider.setupCalls, 1);
    } finally {
      await f.close();
    }
  },
);

await test(
  "expired setup is cleaned while expired result pages preserve invocation and idempotency",
  { skip: !databaseUrl },
  async () => {
    const f = await connectionsLifecycleFixture(databaseUrl!);
    try {
      const expired = await f.create();
      const setup = await f.app.setups.start(
        f.actor,
        f.scope,
        expired.id,
        expired.revision,
        "expire",
        "initial",
      );
      await f.pool.query(
        "UPDATE clawscarf_connections.connection_setups SET created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' WHERE id=$1",
        [setup.setup.id],
      );
      await f.app.maintenance.sweep();
      await f.app.maintenance.sweep();
      assert.equal(
        (await f.app.setups.get(f.actor, f.scope, expired.id, setup.setup.id))
          .setup.state,
        "expired",
      );
      assert.equal(f.provider.deleteCalls, 1);
      const connection = await f.connect();
      const { principal } = await f.runtime();
      f.provider.executeResult = {
        status: "succeeded",
        result: { kind: "inline", data: { text: "é".repeat(25_000) } },
      };
      const input = {
        context: {
          agentId: "a",
          sessionId: "native-session",
          toolCallId: "saved-call",
        },
        connectionId: connection.id,
        generation: connection.generation,
        actionId: "TEST_CALL",
        version: "20260910",
        arguments: {},
      };
      const call = await f.app.broker.call(
        principal,
        input,
        AbortSignal.timeout(30_000),
      );
      assert.equal(call.result.kind, "reference");
      const before = await f.pool.query<{ count: string }>(
        "SELECT count(*) FROM clawscarf_connections.connection_result_pages WHERE invocation_id=$1",
        [call.invocation.id],
      );
      assert.ok(Number(before.rows[0]?.count) > 1);
      await f.pool.query(
        "UPDATE clawscarf_connections.connection_invocations SET created_at=now()-interval '26 hours', completed_at=now()-interval '25 hours' WHERE id=$1",
        [call.invocation.id],
      );
      await f.app.maintenance.sweep();
      const receipt = await f.app.broker.call(
        principal,
        input,
        AbortSignal.timeout(30_000),
      );
      assert.equal(receipt.invocation.id, call.invocation.id);
      assert.equal(receipt.invocation.state, "succeeded");
      assert.deepEqual(receipt.result, {
        kind: "unavailable",
        reason: "expired",
      });
      assert.equal(f.provider.executeCalls, 1);
      const after = await f.pool.query<{ count: string }>(
        "SELECT count(*) FROM clawscarf_connections.connection_result_pages WHERE invocation_id=$1",
        [call.invocation.id],
      );
      assert.equal(after.rows[0]?.count, "0");
    } finally {
      await f.close();
    }
  },
);
