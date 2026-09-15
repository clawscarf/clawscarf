import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { request as httpsRequest } from "node:https";
import { z } from "zod";
import pg from "pg";
import { composeCompanion } from "../../apps/companion/composition.js";
import type { CompanionConfiguration } from "../../apps/companion/config.js";
import type { NativeAuthority } from "../../services/access/types/native.js";
import { NativeFailure } from "../../services/access/types/native-errors.js";
import { hash, token } from "../../services/access/service/session.js";
import {
  connectionCatalogFiles,
  connectionCatalog,
} from "../connections/catalog.js";
import { ConnectionProviderFixture } from "../connections/provider.js";
import { PostgresConnectionRepository } from "../../services/connections/repo/repository.js";
import { StandaloneConnectionAuthority } from "../../services/connections/repo/authority.js";
import { CatalogPublicationService } from "../../services/connections/service/catalog-publication.js";
const databaseUrl = process.env.CLAWSCARF_TEST_DATABASE_URL;
await test(
  "production companion composes optional Connections with real sessions, Postgres and native authority",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const admin = new pg.Pool({ connectionString: databaseUrl });
    const database = `clawscarf_companion_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE "${database}"`);
    const url = new URL(databaseUrl);
    url.pathname = "/" + database;
    const pool = new pg.Pool({ connectionString: url.href });
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-companion-"));
    let app: Awaited<ReturnType<typeof composeCompanion>> | undefined;
    let administrator = true,
      nativeChecks = 0;
    const native: NativeAuthority = {
      observeTeam: () =>
        administrator
          ? Promise.resolve("ready")
          : Promise.reject(new NativeFailure("access_denied")),
      verifyAdministrator: () => {
        nativeChecks++;
        if (!administrator) throw new NativeFailure("access_denied");
        return Promise.resolve({ agentIds: ["research"] });
      },
      prepareTeam: async () => {},
      enroll: async () => {},
      revoke: async () => {},
    };
    const provider = new ConnectionProviderFixture();
    const keyFile = join(directory, "key"),
      apiKeyFile = join(directory, "provider-key");
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const reserved = reservation.address();
    assert.ok(reserved && typeof reserved !== "string");
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    );
    const port = reserved.port;
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const managementAddress = reservation.address();
    assert.ok(managementAddress && typeof managementAddress !== "string");
    const managementPort = managementAddress.port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const certificateFile = join(directory, "management-cert.pem");
    const tlsKeyFile = join(directory, "management-key.pem");
    const config: CompanionConfiguration = {
      access: {
        origin: `http://127.0.0.1:${port}`,
        host: "127.0.0.1",
        port,
        containerLoopbackPublication: false,
        databaseUrl: url.href,
        encryptionKeyFile: keyFile,
        runtime: {
          origin: "http://127.0.0.1:9",
          managementOrigin: `https://127.0.0.1:${managementPort}`,
        },
        managementTls: {
          host: "127.0.0.1",
          port: managementPort,
          certificateFile,
          keyFile: tlsKeyFile,
        },
        identity: { mode: "local", name: "Fixture administrator" },
      },
    };
    const migrate = async (name: string) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          (
            await readFile(
              new URL(
                `../../services/${name}/migrations/001_${name}.sql`,
                import.meta.url,
              ),
              "utf8",
            )
          ).split("-- Down Migration")[0] ?? "",
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
    const listen = async (
      current: Awaited<ReturnType<typeof composeCompanion>>,
    ) => {
      current.ingress.server.listen(port, "127.0.0.1");
      await once(current.ingress.server, "listening");
      assert.ok(current.ingress.managementServer);
      current.ingress.managementServer.listen(managementPort, "127.0.0.1");
      await once(current.ingress.managementServer, "listening");
      const address = current.ingress.server.address();
      assert.ok(address && typeof address !== "string");
      const code = token();
      await current.repository.createLocalToken(hash(code));
      const login = await current.service.localLogin(code);
      const session = await current.access.authenticate(login.session);
      const headers = {
        host: `127.0.0.1:${port}`,
        origin: config.access.origin,
        cookie: `clawscarf_session=${login.session}`,
        "x-csrf-token": session.csrfToken,
      };
      return {
        headers,
        request: (path: string, init: RequestInit = {}) =>
          fetch(`http://127.0.0.1:${address.port}${path}`, {
            ...init,
            headers: { ...headers, ...init.headers },
            signal: AbortSignal.timeout(5000),
          }),
      };
    };
    const runtimePath = "/_clawscarf/connections/v1/connector-runtime/search";
    const credentialPath = "/_clawscarf/connections/v1/connection-credentials";
    try {
      await promisify(execFile)("openssl", [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "-keyout",
        tlsKeyFile,
        "-out",
        certificateFile,
      ]);
      const ca = await readFile(certificateFile);
      // The native plugin sends the actual broker Host and no acting-human session.
      const brokerRequest = (
        headers: Record<string, string> = {},
        path = runtimePath,
      ) =>
        new Promise<number | undefined>((resolve, reject) => {
          const req = httpsRequest(
            {
              hostname: "127.0.0.1",
              port: managementPort,
              ca,
              path,
              method: "POST",
              headers: { "content-type": "application/json", ...headers },
            },
            (res) => {
              res.resume();
              res.once("end", () => resolve(res.statusCode));
            },
          );
          req.on("error", reject);
          req.setTimeout(5000, () =>
            req.destroy(new Error("Broker request timed out")),
          );
          req.end(
            JSON.stringify({
              context: { agentId: "research", toolCallId: "https-proof" },
              query: "test",
            }),
          );
        });
      await writeFile(keyFile, randomBytes(32));
      await writeFile(apiKeyFile, "fixture-only");
      await migrate("access");
      app = await composeCompanion(config, { native, connections: provider });
      const serverId = app.identity.serverId;
      const disabled = await listen(app);
      assert.equal(
        await brokerRequest(),
        403,
        "Disabled Connections has no management API alias",
      );
      let response = await disabled.request(
        "/_clawscarf/connections/v1/connection-capabilities",
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { enabled: false });
      response = await disabled.request("/_clawscarf/session");
      assert.deepEqual(
        ((await response.json()) as { links: unknown[] }).links,
        [],
      );
      assert.equal(
        nativeChecks,
        0,
        "Base session and disabled capabilities do not query native authority.",
      );
      response = await disabled.request(
        "/_clawscarf/connections/v1/connections",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      assert.equal(response.status, 404);
      await response.body?.cancel();
      assert.equal(provider.setupCalls, 0);
      await app.close();
      app = undefined;
      await migrate("connections");
      const catalogDir = join(directory, "catalog");
      await mkdir(catalogDir);
      for (const [path, contents] of connectionCatalogFiles()) {
        await mkdir(dirname(join(catalogDir, path)), { recursive: true });
        await writeFile(join(catalogDir, path), contents);
      }
      const repository = new PostgresConnectionRepository(pool, (client) => ({
        authority: new StandaloneConnectionAuthority(client, serverId, {
          resolveSessionHash: () => Promise.resolve(null),
          verifyAdministrator: () => {
            throw Error("Publication does not require a user.");
          },
        }),
      }));
      await new CatalogPublicationService({
        transaction: (work) =>
          repository.transaction((store) => work(store.catalogPublication)),
      }).publish(connectionCatalog(), null);
      const enabled = {
        ...config,
        connections: {
          projectId: "fixture",
          apiKeyFile,
          catalogDirectory: catalogDir,
        },
      };
      app = await composeCompanion(enabled, { native, connections: provider });
      const client = await listen(app);
      response = await client.request("/_clawscarf/session");
      assert.deepEqual(
        ((await response.json()) as { links: unknown[] }).links,
        [{ label: "Connections", href: "/_clawscarf/connections/" }],
      );
      assert.equal(
        nativeChecks,
        0,
        "Navigation metadata does not trigger a native RPC.",
      );
      response = await client.request("/_clawscarf/connections/v1/connections");
      assert.equal(response.status, 200);
      await response.body?.cancel();
      assert.ok(nativeChecks > 0);
      response = await client.request(
        "/_clawscarf/connections/v1/connections",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": "wrong",
            "idempotency-key": randomUUID(),
          },
          body: JSON.stringify({
            connectorId: "test",
            name: "Denied account",
            grant: { mode: "all" },
          }),
        },
      );
      assert.equal(response.status, 403);
      await response.body?.cancel();
      response = await client.request(
        "/_clawscarf/connections/v1/connections",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": randomUUID(),
          },
          body: JSON.stringify({
            connectorId: "test",
            name: "Composed account",
            grant: { mode: "all" },
          }),
        },
      );
      assert.equal(response.status, 201, await response.text());
      response = await client.request(credentialPath, { method: "POST" });
      assert.equal(response.status, 200);
      const credential = z
        .object({ token: z.string().min(1) })
        .parse(await response.json());
      const authorization = `Bearer ${credential.token}`;
      assert.equal(await brokerRequest(), 401);
      assert.equal(
        await brokerRequest({ authorization: "Bearer invalid" }),
        401,
      );
      assert.equal(await brokerRequest({ authorization }), 200);
      assert.equal(
        await brokerRequest({ authorization, cookie: client.headers.cookie }),
        401,
      );
      assert.equal(
        await brokerRequest({ authorization }, credentialPath),
        403,
        "The runtime credential cannot use management routes on the API origin",
      );
      response = await client.request(credentialPath, { method: "DELETE" });
      assert.equal(response.status, 204);
      await response.body?.cancel();
      assert.equal(
        await brokerRequest({ authorization }),
        401,
        "Revocation applies to the next HTTPS request",
      );
      administrator = false;
      response = await client.request("/_clawscarf/connections/v1/connections");
      assert.equal(response.status, 403);
      await response.body?.cancel();
      response = await client.request("/_clawscarf/logout", { method: "POST" });
      assert.equal(response.status, 200);
      await response.body?.cancel();
      response = await client.request("/_clawscarf/connections/v1/connections");
      assert.equal(response.status, 401);
      await response.body?.cancel();
      await app.close();
      app = undefined;
      await writeFile(apiKeyFile, "");
      await assert.rejects(
        composeCompanion(enabled, { native, connections: provider }),
        /Invalid Connections configuration/,
      );
    } finally {
      await app?.close();
      await pool.end();
      await admin.query(`DROP DATABASE "${database}"`);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
