import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { initializeConnectionCredential } from "../../services/connections/repo/bootstrap.js";
import {
  initializeLocalDatabase,
  LocalDatabaseError,
} from "../../scripts/deployment/database.js";
const execute = promisify(execFile);
const failure = (code: LocalDatabaseError["code"]) => (error: unknown) =>
  error instanceof LocalDatabaseError && error.code === code;

await test("local database rejects unsafe targets before connection", async () => {
  for (const adminUrl of [
    "postgres://admin:password@example.com/clawscarf",
    "postgres://admin:password@localhost/other",
    "postgres://admin:password@localhost/clawscarf?host=example.com",
    "postgres://%ZZ:password@localhost/clawscarf",
  ]) {
    await assert.rejects(
      initializeLocalDatabase({
        adminUrl,
        runtimePassword: randomBytes(32).toString("hex"),
        ownerId: randomUUID(),
      }),
      failure("invalid_configuration"),
    );
  }
});

await test(
  "isolated PostgreSQL setup owns only its database and grants runtime DML without DDL",
  { skip: process.env.CLAWSCARF_TEST_LOCAL_DATABASE !== "1", timeout: 120000 },
  async () => {
    const name = `clawscarf-local-db-test-${randomUUID()}`;
    const adminPassword = randomBytes(32).toString("hex");
    let admin: pg.Client | undefined;
    let runtime: pg.Client | undefined;
    let started = false;
    try {
      await execute(
        "docker",
        [
          "run",
          "--detach",
          "--name",
          name,
          "--publish",
          "127.0.0.1::5432",
          "--env",
          "POSTGRES_PASSWORD",
          "--env",
          "POSTGRES_DB=clawscarf",
          "postgres@sha256:47f917f7409eacd22fc5dfb1dee634e1b55cf0c01d1a7eb701be2227a03e0641",
        ],
        { env: { ...process.env, POSTGRES_PASSWORD: adminPassword } },
      );
      started = true;
      const ports = (
        await execute("docker", ["port", name, "5432/tcp"])
      ).stdout.trim();
      assert.match(ports, /^127\.0\.0\.1:\d+$/);
      const adminUrl = `postgres://postgres:${adminPassword}@${ports}/clawscarf`;
      for (let attempt = 0; attempt < 80; attempt++) {
        const candidate = new pg.Client({ connectionString: adminUrl });
        try {
          await candidate.connect();
          admin = candidate;
          break;
        } catch {
          await candidate.end();
          await setTimeout(250);
        }
      }
      assert.ok(admin, "Disposable PostgreSQL did not become ready");
      const ownerId = randomUUID();
      const runtimePassword = `quotes'\\%25:@/#?${randomBytes(24).toString("hex")}`;
      const input = { adminUrl, runtimePassword, ownerId };
      // Foreign unmarked data must remain intact; no marker or role is adopted.
      await admin.query("CREATE TABLE public.keep_me (value text)");
      await admin.query("INSERT INTO public.keep_me VALUES ('retained')");
      await assert.rejects(
        initializeLocalDatabase(input),
        failure("ownership_conflict"),
      );
      assert.equal(
        (
          await admin.query<{ value: string }>(
            "SELECT value FROM public.keep_me",
          )
        ).rows[0]?.value,
        "retained",
      );
      assert.equal(
        (
          await admin.query<{ marker: string | null }>(
            "SELECT to_regnamespace('clawscarf_operator')::text AS marker",
          )
        ).rows[0]?.marker,
        null,
      );
      await admin.query("DROP TABLE public.keep_me");
      await admin.query("CREATE ROLE clawscarf_runtime");
      await assert.rejects(
        initializeLocalDatabase(input),
        failure("ownership_conflict"),
      );
      await admin.query("DROP ROLE clawscarf_runtime");
      const result = await initializeLocalDatabase(input);
      for (const current of [input, { ...input, connections: false }]) {
        assert.deepEqual(await initializeLocalDatabase(current), result);
        assert.deepEqual(
          (
            await admin.query<{
              schema: string | null;
              migrations: string | null;
            }>(
              "SELECT to_regnamespace('clawscarf_connections')::text AS schema, to_regclass('public.clawscarf_connections_migrations')::text AS migrations",
            )
          ).rows,
          [{ schema: null, migrations: null }],
        );
      }
      assert.equal(
        decodeURIComponent(new URL(result.runtimeUrl).password),
        runtimePassword,
      );
      runtime = new pg.Client({ connectionString: result.runtimeUrl });
      await runtime.connect();
      const id = randomUUID();
      await runtime.query(
        "INSERT INTO clawscarf_access.users (id,issuer,subject,email,name) VALUES ($1,'local','admin','admin@example.com','Admin')",
        [id],
      );
      await runtime.query(
        "UPDATE clawscarf_access.users SET name='Updated' WHERE id=$1",
        [id],
      );
      assert.equal(
        (
          await runtime.query<{ name: string }>(
            "SELECT name FROM clawscarf_access.users WHERE id=$1",
            [id],
          )
        ).rows[0]?.name,
        "Updated",
      );
      for (const sql of [
        "CREATE TABLE public.forbidden (id int)",
        "CREATE TABLE clawscarf_access.forbidden (id int)",
        "CREATE SCHEMA forbidden",
        "CREATE TEMP TABLE forbidden (id int)",
        "ALTER TABLE clawscarf_access.users ADD COLUMN forbidden text",
        "TRUNCATE clawscarf_access.users",
        "SELECT * FROM clawscarf_operator.installation",
        "SELECT * FROM public.clawscarf_access_migrations",
        "CREATE ROLE forbidden",
        "SET ROLE postgres",
      ]) {
        await assert.rejects(
          runtime.query(sql),
          (error: unknown) =>
            error instanceof Error && "code" in error && error.code === "42501",
          sql,
        );
      }
      assert.deepEqual(await initializeLocalDatabase(input), result);
      assert.equal(
        (
          await runtime.query<{ name: string }>(
            "SELECT name FROM clawscarf_access.users WHERE id=$1",
            [id],
          )
        ).rows[0]?.name,
        "Updated",
      );
      await assert.rejects(
        initializeLocalDatabase({ ...input, ownerId: randomUUID() }),
        failure("ownership_conflict"),
      );
      await assert.rejects(
        initializeLocalDatabase({
          ...input,
          runtimePassword: randomBytes(32).toString("hex"),
        }),
        failure("runtime_credentials_changed"),
      );
      assert.deepEqual(await initializeLocalDatabase(input), result);
      // A failed optional migration preserves both retained Access data and its journal.
      await admin.query("CREATE SCHEMA clawscarf_connections");
      await admin.query(
        "CREATE TABLE clawscarf_connections.keep_me (value text)",
      );
      await admin.query(
        "INSERT INTO clawscarf_connections.keep_me VALUES ('retained')",
      );
      await assert.rejects(
        initializeLocalDatabase({ ...input, connections: true }),
        failure("database_setup_failed"),
      );
      assert.deepEqual(
        (
          await admin.query<{ value: string }>(
            "SELECT value FROM clawscarf_connections.keep_me",
          )
        ).rows,
        [{ value: "retained" }],
      );
      assert.equal(
        (
          await admin.query<{ count: string }>(
            "SELECT count(*) FROM public.clawscarf_connections_migrations",
          )
        ).rows[0]?.count,
        "0",
      );
      assert.equal(
        (
          await runtime.query<{ name: string }>(
            "SELECT name FROM clawscarf_access.users WHERE id=$1",
            [id],
          )
        ).rows[0]?.name,
        "Updated",
      );
      await admin.query("DROP TABLE clawscarf_connections.keep_me");
      await admin.query("DROP SCHEMA clawscarf_connections");
      const enabled = { ...input, connections: true };
      assert.deepEqual(await initializeLocalDatabase(enabled), result);
      const credentials = new pg.Pool({ connectionString: result.runtimeUrl });
      try {
        const initial = {
          serverId: randomUUID(),
          credentialId: randomUUID(),
          credentialGeneration: 1,
          hash: randomBytes(32).toString("hex"),
          state: "active" as const,
        };
        await Promise.all([
          initializeConnectionCredential(credentials, initial),
          initializeConnectionCredential(credentials, initial),
        ]);
        await credentials.query(
          "UPDATE clawscarf_connections.connection_credentials SET state='revoked' WHERE id=$1",
          [initial.credentialId],
        );
        await initializeConnectionCredential(credentials, initial);
        assert.deepEqual(
          (
            await credentials.query<{ state: string }>(
              "SELECT state FROM clawscarf_connections.connection_credentials WHERE id=$1",
              [initial.credentialId],
            )
          ).rows,
          [{ state: "revoked" }],
        );
        await assert.rejects(
          initializeConnectionCredential(credentials, {
            ...initial,
            credentialId: randomUUID(),
          }),
        );
        await assert.rejects(
          initializeConnectionCredential(credentials, {
            ...initial,
            hash: randomBytes(32).toString("hex"),
          }),
        );
        assert.equal(
          (
            await credentials.query<{ count: string }>(
              "SELECT count(*) FROM clawscarf_connections.connection_credentials WHERE server_id=$1",
              [initial.serverId],
            )
          ).rows[0]?.count,
          "1",
        );
      } finally {
        await credentials.end();
      }
      const connectionId = randomUUID();
      const serverId = randomUUID();
      await runtime.query(
        "INSERT INTO clawscarf_connections.connections (id,server_id,connector_id,name,grant_policy,state,generation,revision,created_at,updated_at) VALUES ($1,$2,'test','Work','{\"mode\":\"all\"}','not_connected',1,1,now(),now())",
        [connectionId, serverId],
      );
      await runtime.query(
        "UPDATE clawscarf_connections.connections SET name='Retained' WHERE id=$1",
        [connectionId],
      );
      for (const sql of [
        "CREATE TABLE clawscarf_connections.forbidden (id int)",
        "ALTER TABLE clawscarf_connections.connections ADD COLUMN forbidden text",
        "TRUNCATE clawscarf_connections.connections CASCADE",
        "SELECT * FROM public.clawscarf_connections_migrations",
        "DELETE FROM public.clawscarf_connections_migrations",
      ]) {
        await assert.rejects(
          runtime.query(sql),
          (error: unknown) =>
            error instanceof Error && "code" in error && error.code === "42501",
          sql,
        );
      }
      for (const current of [
        enabled,
        { ...input, connections: false },
        input,
        enabled,
      ]) {
        assert.deepEqual(await initializeLocalDatabase(current), result);
        assert.deepEqual(
          (
            await runtime.query<{ name: string }>(
              "SELECT name FROM clawscarf_connections.connections WHERE id=$1",
              [connectionId],
            )
          ).rows,
          [{ name: "Retained" }],
        );
      }
      assert.equal(
        (
          await admin.query<{ count: string }>(
            "SELECT count(*) FROM public.clawscarf_connections_migrations",
          )
        ).rows[0]?.count,
        "1",
      );
      await runtime.query(
        "DELETE FROM clawscarf_connections.connections WHERE id=$1",
        [connectionId],
      );
      await runtime.query("DELETE FROM clawscarf_access.users WHERE id=$1", [
        id,
      ]);
      await admin.query("ALTER ROLE clawscarf_runtime CREATEDB");
      await assert.rejects(
        initializeLocalDatabase(input),
        failure("ownership_conflict"),
      );
    } finally {
      await runtime?.end();
      await admin?.end();
      if (started)
        await execute("docker", ["rm", "--force", "--volumes", name]);
    }
  },
);
