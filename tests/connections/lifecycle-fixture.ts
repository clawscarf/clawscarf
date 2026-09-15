import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createConnectionsService } from "../../services/connections/composition.js";
import { StandaloneConnectionAuthority } from "../../services/connections/repo/authority.js";
import { PostgresConnectionRepository } from "../../services/connections/repo/repository.js";
import { CatalogPublicationService } from "../../services/connections/service/catalog-publication.js";
import { denied } from "../../services/connections/shared/errors.js";
import type { ConnectorIdentity } from "../../services/connections/types/authority.js";
import { connectionCatalog } from "./catalog.js";
import { ConnectionProviderFixture } from "./provider.js";

/** Every test owns its own database; configured local installation data is never reset. */
export async function connectionsLifecycleFixture(databaseUrl: string) {
  const admin = new Pool({ connectionString: databaseUrl });
  const database = `clawscarf_connections_${randomUUID().replaceAll("-", "")}`;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
  } catch (error) {
    await admin.end();
    throw error;
  }
  const url = new URL(databaseUrl);
  url.pathname = "/" + database;
  const pool = new Pool({ connectionString: url.href });
  const close = async () => {
    await pool.end();
    try {
      await admin.query(`DROP DATABASE "${database}"`);
    } finally {
      await admin.end();
    }
  };
  try {
    const migration = await readFile(
      new URL(
        "../../services/connections/migrations/001_connections.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration.split("-- Down Migration")[0] ?? "");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const actor = { user: { id: randomUUID() }, sessionHash: "a".repeat(64) };
    const scope = { serverId: randomUUID() };
    const authority = { session: true, administrator: true };
    const identity: ConnectorIdentity = {
      resolveSessionHash: (hash) =>
        Promise.resolve(
          authority.session && hash === actor.sessionHash
            ? { hash, user: actor.user }
            : null,
        ),
      verifyAdministrator: () => {
        if (!authority.administrator) denied();
        return Promise.resolve({ userId: actor.user.id, agentIds: ["a", "b"] });
      },
    };
    const repository = new PostgresConnectionRepository(pool, (client) => ({
      authority: new StandaloneConnectionAuthority(
        client,
        scope.serverId,
        identity,
      ),
    }));
    const catalog = connectionCatalog();
    await new CatalogPublicationService({
      transaction: (work) =>
        repository.transaction((store) => work(store.catalogPublication)),
    }).publish(catalog, null);
    const provider = new ConnectionProviderFixture();
    const app = await createConnectionsService({
      pool,
      ...scope,
      key: randomBytes(32),
      catalog,
      identity,
      provider,
      configuration: {
        projectId: "test",
        apiKey: "fixture",
        callbackUrl: "http://127.0.0.1:18899/_clawscarf/connections/verify",
        publicOrigin: "http://127.0.0.1:18899",
      },
    });
    const create = () =>
      app.service.create(actor, scope, randomUUID(), {
        connectorId: "test",
        name: "Work",
        grant: { mode: "all" },
      });
    const connect = async () => {
      const created = await create();
      const started = await app.setups.start(
        actor,
        scope,
        created.id,
        created.revision,
        randomUUID(),
        "initial",
      );
      const setup = await repository.transaction((store) =>
        store.setups.get(scope, started.setup.id),
      );
      if (!setup?.accountId) throw Error("Fixture account was not allocated.");
      const accountId = setup.accountId;
      const account = await repository.transaction((store) =>
        store.accounts.get(scope, accountId),
      );
      if (!account) throw Error("Fixture account is missing.");
      provider.identityAccount = account.binding.accountId;
      await app.setups.verify(actor, randomUUID());
      return app.service.get(actor, scope, created.id);
    };
    const runtime = async () => {
      const credential = await app.credentialManagement.rotate(actor, scope);
      return {
        credential,
        principal: await app.credentials.authenticate(credential.token),
      };
    };
    return {
      pool,
      repository,
      provider,
      app,
      actor,
      scope,
      authority,
      create,
      connect,
      runtime,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
