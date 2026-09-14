import { StandaloneConnectionAuthority } from "../../services/connections/repo/authority.js";
import { qualifyConnectionsHttp } from "./http.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createConnectionsService } from "../../services/connections/composition.js";
import { PostgresConnectionRepository } from "../../services/connections/repo/repository.js";
import { NativeConnectorAdministratorVerifier } from "../../services/connections/providers/authority.js";
import { CatalogPublicationService } from "../../services/connections/service/catalog-publication.js";
import type { ConnectorIdentity } from "../../services/connections/types/authority.js";
import { denied } from "../../services/connections/shared/errors.js";
import { connectionCatalog } from "./catalog.js";
import { ConnectionProviderFixture } from "./provider.js";

const url = process.env.CLAWSCARF_CONNECTIONS_TEST_DATABASE_URL;
await test(
  "single-server account flow, grants, receipts and credential/session revocation use real Postgres",
  { skip: !url },
  async () => {
    const pool = new Pool({ connectionString: url });
    const serverId = randomUUID(),
      userId = randomUUID(),
      sessionHash = "a".repeat(64);
    let active = true,
      administrator = true;
    const identity: ConnectorIdentity = {
      resolveSessionHash: (hash) =>
        Promise.resolve(
          active && hash === sessionHash
            ? { hash, user: { id: userId } }
            : null,
        ),
      verifyAdministrator: () => {
        if (!administrator) denied();
        return Promise.resolve({ userId, agentIds: ["a", "b"] });
      },
    };
    const actor = { user: { id: userId }, sessionHash },
      scope = { serverId };
    const verifier = new NativeConnectorAdministratorVerifier(
      identity,
      serverId,
    );
    const repository = new PostgresConnectionRepository(pool, (client) => ({
      authority: new StandaloneConnectionAuthority(client, serverId, identity),
    }));
    try {
      const migration = await readFile(
        new URL(
          "../../services/connections/migrations/001_connections.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const client = await pool.connect();
      await client.query("BEGIN");
      await client.query("DROP SCHEMA IF EXISTS clawscarf_connections CASCADE");
      await client.query(migration.split("-- Down Migration")[0] ?? "");
      await client.query("COMMIT");
      client.release();
      const catalog = connectionCatalog();
      await new CatalogPublicationService({
        transaction: (work) =>
          repository.transaction((store) => work(store.catalogPublication)),
      }).publish(catalog, null);
      const provider = new ConnectionProviderFixture();
      const app = await createConnectionsService({
        pool,
        serverId,
        key: randomBytes(32),
        catalog,
        identity,
        provider,
        configuration: {
          projectId: "test",
          apiKey: "fixture",
          callbackUrl: "https://test.invalid/connections/verify",
          publicOrigin: "https://test.invalid",
        },
      });
      await qualifyConnectionsHttp(app, actor);
      const input = {
        connectorId: "test",
        name: "Work",
        grant: { mode: "all" as const },
      };
      const created = await app.service.create(actor, scope, "create", input);
      assert.equal(
        (await app.service.create(actor, scope, "create", input)).id,
        created.id,
      );
      const duplicate = await app.service.create(
        actor,
        scope,
        "create-duplicate",
        input,
      );
      assert.notEqual(duplicate.id, created.id);
      const setup = await app.setups.start(
        actor,
        scope,
        created.id,
        created.revision,
        "setup",
        "initial",
      );
      assert.equal(setup.setup.state, "pending");
      assert.equal(provider.setupCalls, 1);
      assert.equal(
        (
          await app.setups.start(
            actor,
            scope,
            created.id,
            created.revision,
            "setup",
            "initial",
          )
        ).setup.id,
        setup.setup.id,
      );
      assert.equal(provider.setupCalls, 1);
      provider.identityAccount = [...provider.accounts.keys()][0] ?? null;
      const completed = await app.setups.verify(actor, "provider-session");
      assert.equal(completed.connectionId, created.id);
      let connection = await app.service.get(actor, scope, created.id);
      assert.equal(connection.state, "connected");
      const token = await app.credentialManagement.rotate(actor, scope);
      const principal = await app.credentials.authenticate(token.token);
      const context = {
        agentId: "a",
        sessionId: "session",
        toolCallId: "call",
      };
      const description = await app.broker.describe(
        principal,
        context,
        created.id,
        "TEST_CALL",
      );
      assert.ok(description);
      const result = await app.broker.call(
        principal,
        {
          context,
          connectionId: created.id,
          generation: connection.generation,
          actionId: "TEST_CALL",
          version: "20260910",
          arguments: { unlisted: "accepted" },
        },
        AbortSignal.timeout(30000),
      );
      assert.equal(result.invocation.state, "succeeded");
      await app.broker.call(
        principal,
        {
          context,
          connectionId: created.id,
          generation: connection.generation,
          actionId: "TEST_CALL",
          version: "20260910",
          arguments: { unlisted: "accepted" },
        },
        AbortSignal.timeout(30000),
      );
      assert.equal(provider.executeCalls, 1);
      connection = await app.service.update(
        actor,
        scope,
        created.id,
        connection.revision,
        "grant",
        { name: "Work", grant: { mode: "selected", agentIds: ["b"] } },
      );
      await assert.rejects(
        app.broker.describe(principal, context, created.id, "TEST_CALL"),
      );
      await app.credentialManagement.rotate(actor, scope);
      await assert.rejects(app.credentials.authenticate(token.token));
      administrator = false;
      await assert.rejects(app.service.list(actor, scope, 20, null));
      administrator = true;
      active = false;
      await assert.rejects(verifier.verify(actor, scope));
      active = true;
      await assert.rejects(
        app.service.list(actor, { serverId: randomUUID() }, 20, null),
      );
      await app.service.disconnect(
        actor,
        scope,
        created.id,
        connection.revision,
        "disconnect",
      );
      await app.maintenance.sweep();
      assert.equal(provider.deleteCalls, 1);
    } finally {
      await pool.end();
    }
  },
);
