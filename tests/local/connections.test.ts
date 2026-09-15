import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { runner } from "node-pg-migrate";
import { Pool } from "pg";
import { connectionCatalogFiles } from "../connections/catalog.js";
import {
  loadInitialConnections,
  prepareInitialConnections,
  publishInitialConnections,
  readInitialConnectionsEndpoint,
} from "../../scripts/local/connections.js";
import { initializeState } from "../../scripts/local/state.js";
import { parseLocalInput } from "../../scripts/local/configuration.js";
import { ensureCertificates } from "../../scripts/local/certificates.js";
import { composeConfiguration } from "../../scripts/local/compose.js";
import {
  initialRuntimePolicy,
  prepareRuntimePolicy,
} from "../../scripts/local/policy.js";
import { LocalSetupError } from "../../scripts/local/process.js";
import { openConnectorCatalog } from "../../services/connections/providers/catalog/provider.js";

async function fixture(
  t: TestContext,
  external?: { brokerUrl: string; ca?: boolean },
) {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-local-connections-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = {
    mode: "local" as const,
    projectId: "test-project",
    apiKeyFile: join(root, "key"),
    catalogDirectory: join(root, "catalog"),
  };
  const files = connectionCatalogFiles();
  for (const [path, content] of files) {
    const target = join(input.catalogDirectory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await writeFile(input.apiKeyFile, "private-provider-key\n", { mode: 0o600 });
  const directory = join(root, "installation");
  const state = await initializeState(
    directory,
    parseLocalInput({
      name: "connections-test",
      administratorName: "Ada",
      connections: external
        ? {
            mode: "external",
            brokerUrl: external.brokerUrl,
            ...(external.ca
              ? { caFile: join(directory, "private/management-ca.pem") }
              : {}),
          }
        : input,
      runtimeImage: `sha256:${"a".repeat(64)}`,
      companionImage: `sha256:${"b".repeat(64)}`,
      openshellCli: "/tools/openshell",
      openshellGateway: "/tools/gateway",
      cpu: "1",
      memory: "2Gi",
      ports: {
        controller: 17211,
        application: 17212,
        widgets: 17213,
        management: 17214,
        native: 17215,
        nativeWidgets: 17216,
        database: 17217,
      },
    }),
  );
  await ensureCertificates(join(directory, "private"));
  return { root, input, directory, files, state };
}
function code(expected: string) {
  return (error: unknown) =>
    error instanceof LocalSetupError &&
    error.code === expected &&
    !error.message.includes("private-provider-key");
}
await test("optional Connections remains unconfigured without reading files, connecting to PostgreSQL or preparing state", async () => {
  assert.equal(await loadInitialConnections(undefined), undefined);
  await prepareInitialConnections("/does-not-exist", undefined);
  const pool = new Pool({
    connectionString: "postgresql://invalid.invalid:1/unconfigured",
    connectionTimeoutMillis: 1,
  });
  try {
    await publishInitialConnections(pool, undefined);
  } finally {
    await pool.end();
  }
});
await test("verified Connections snapshot is copied privately once and does not follow later source edits", async (t) => {
  const f = await fixture(t);
  const loaded = await loadInitialConnections(f.input);
  assert.ok(loaded?.mode === "local");
  assert.equal(loaded.projectId, "test-project");
  assert.equal(
    (await readdir(join(f.directory, "private"))).includes("connections"),
    false,
  );
  await writeFile(
    join(f.input.catalogDirectory, "test.json"),
    '{"changed":true}',
  );
  await writeFile(f.input.apiKeyFile, "changed-source-key");
  await prepareInitialConnections(f.directory, loaded);
  const endpoint = await readInitialConnectionsEndpoint(f.directory);
  assert.equal(endpoint?.brokerUrl, "https://host.docker.internal:17214");
  assert.equal(
    endpoint?.ca,
    await readFile(join(f.directory, "private/management-ca.pem"), "utf8"),
  );
  const target = join(f.directory, "private/connections");
  assert.equal((await lstat(target)).mode & 0o777, 0o700);
  assert.equal((await lstat(join(target, "api-key"))).mode & 0o777, 0o600);
  assert.equal(
    await readFile(join(target, "api-key"), "utf8"),
    "private-provider-key\n",
  );
  for (const [path, content] of f.files) {
    assert.equal(
      await readFile(join(target, "catalog", path), "utf8"),
      content,
    );
    assert.equal(
      (await lstat(join(target, "catalog", path))).mode & 0o777,
      0o600,
    );
  }
  const catalog = await openConnectorCatalog(join(target, "catalog"), {
    verifyDetails: true,
  });
  assert.equal(catalog.version, loaded.catalogVersion);
  assert.ok(
    await loaded.catalog.describe("test", "TEST_CALL"),
    "Validated details remain usable after the loader's temporary snapshot is removed",
  );
  await prepareInitialConnections(f.directory, loaded);
});
await test("invalid provider files and catalog symlinks or detail corruption fail before private preparation", async (t) => {
  const f = await fixture(t);
  const key = await readFile(f.input.apiKeyFile);
  await chmod(f.input.apiKeyFile, 0o644);
  await assert.rejects(
    loadInitialConnections(f.input),
    code("invalid_connections_setup"),
  );
  await chmod(f.input.apiKeyFile, 0o600);
  await writeFile(f.input.apiKeyFile, " \n");
  await assert.rejects(
    loadInitialConnections(f.input),
    code("invalid_connections_setup"),
  );
  await writeFile(f.input.apiKeyFile, key);
  const alternateKey = join(f.root, "key-link");
  await symlink(f.input.apiKeyFile, alternateKey);
  await assert.rejects(
    loadInitialConnections({ ...f.input, apiKeyFile: alternateKey }),
    code("invalid_connections_setup"),
  );
  const linkedDirectory = join(f.root, "catalog-link");
  await symlink(f.input.catalogDirectory, linkedDirectory);
  await assert.rejects(
    loadInitialConnections({ ...f.input, catalogDirectory: linkedDirectory }),
    code("invalid_connections_setup"),
  );
  const detail = join(f.input.catalogDirectory, "test.json");
  await rm(detail);
  await symlink(f.input.apiKeyFile, detail);
  await assert.rejects(
    loadInitialConnections(f.input),
    code("invalid_connections_setup"),
  );
  await rm(detail);
  await writeFile(detail, '{"connectorId":"test","actions":[]}');
  await assert.rejects(
    loadInitialConnections(f.input),
    code("invalid_connections_setup"),
  );
  assert.equal(
    (await readdir(join(f.directory, "private"))).includes("connections"),
    false,
  );
});
await test("retained Connections key, project and catalog bytes are immutable during initial setup", async (t) => {
  const f = await fixture(t);
  const loaded = await loadInitialConnections(f.input);
  assert.ok(loaded?.mode === "local");
  await prepareInitialConnections(f.directory, loaded);
  await assert.rejects(
    prepareInitialConnections(f.directory, {
      ...loaded,
      projectId: "other-project",
    }),
    code("configuration_changed"),
  );
  await assert.rejects(
    prepareInitialConnections(f.directory, {
      ...loaded,
      apiKey: Buffer.from("replacement"),
    }),
    code("configuration_changed"),
  );
  const detail = join(f.directory, "private/connections/catalog/test.json");
  const original = await readFile(detail);
  // Even semantically equivalent JSON is a different retained artifact.
  await writeFile(detail, Buffer.concat([original, Buffer.from("\n")]));
  await assert.rejects(
    prepareInitialConnections(f.directory, loaded),
    code("configuration_changed"),
  );
  assert.equal((await readFile(detail)).length, original.length + 1);
  await writeFile(detail, original);
  await chmod(detail, 0o644);
  await assert.rejects(
    prepareInitialConnections(f.directory, loaded),
    code("configuration_changed"),
  );
  await chmod(detail, 0o600);
  await writeFile(
    join(f.directory, "private/connections/catalog/unexpected.json"),
    "{}",
    { mode: 0o600 },
  );
  await assert.rejects(
    prepareInitialConnections(f.directory, loaded),
    code("configuration_changed"),
  );
  assert.equal(
    await readFile(join(f.directory, "private/connections/api-key"), "utf8"),
    "private-provider-key\n",
  );
});
await test("preexisting unowned or symlinked Connections destinations are never adopted", async (t) => {
  const f = await fixture(t);
  const loaded = await loadInitialConnections(f.input);
  assert.ok(loaded?.mode === "local");
  const target = join(f.directory, "private/connections");
  await mkdir(target, { mode: 0o700 });
  await assert.rejects(
    prepareInitialConnections(f.directory, loaded),
    code("configuration_changed"),
  );
  assert.deepEqual(await readdir(target), []);
  await rm(target, { recursive: true });
  await symlink(f.input.catalogDirectory, target);
  await assert.rejects(
    prepareInitialConnections(f.directory, loaded),
    code("configuration_changed"),
  );
  assert.ok((await lstat(target)).isSymbolicLink());
});

const databaseUrl = process.env.CLAWSCARF_CONNECTIONS_TEST_DATABASE_URL;
await test("external Connections retains only endpoint and CA, never reads provider inputs or contacts the local database", async (t) => {
  const f = await fixture(t, {
    brokerUrl: "https://broker.example:9443/customer/team/",
    ca: true,
  });
  await rm(f.input.apiKeyFile);
  await rm(f.input.catalogDirectory, { recursive: true });
  const loaded = await loadInitialConnections(f.state.input.connections);
  assert.ok(loaded?.mode === "external");
  const expected = {
    brokerUrl: "https://broker.example:9443/customer/team",
    network: {
      host: "broker.example",
      port: 9443,
      protocol: "tcp",
      binary: "/usr/local/bin/node",
    },
    ca: await readFile(join(f.directory, "private/management-ca.pem"), "utf8"),
  };
  assert.deepEqual(loaded.endpoint, expected);
  const pool = new Pool({
    connectionString: "postgresql://invalid.invalid:1/unconfigured",
    connectionTimeoutMillis: 1,
  });
  try {
    await publishInitialConnections(pool, loaded);
  } finally {
    await pool.end();
  }
  assert.deepEqual(
    await prepareInitialConnections(f.directory, loaded),
    expected,
  );
  assert.deepEqual(await readInitialConnectionsEndpoint(f.directory), expected);
  assert.deepEqual(
    (await readdir(join(f.directory, "private/connections"))).sort(),
    ["endpoint.json", "owner.json"],
  );
  assert.equal(
    (await lstat(join(f.directory, "private/connections/endpoint.json"))).mode &
      0o777,
    0o600,
  );
  const compose = composeConfiguration(f.state, f.directory);
  assert.equal(
    compose.services.companion.volumes.some((path) =>
      path.includes("/connections"),
    ),
    false,
  );
  const policySource = await readFile(
    new URL("../../deploy/openshell/policy.yaml", import.meta.url),
    "utf8",
  );
  const policy = initialRuntimePolicy(
    policySource,
    undefined,
    undefined,
    undefined,
    loaded.endpoint,
  );
  assert.deepEqual(policy.network_policies, {
    connections_broker: {
      name: "Connections broker",
      endpoints: [{ host: "broker.example", port: 9443, tls: "skip" }],
      binaries: [{ path: "/usr/local/bin/node" }],
    },
  });
  assert.equal(JSON.stringify(policy).includes(expected.ca), false);
  await prepareRuntimePolicy(
    f.directory,
    undefined,
    undefined,
    undefined,
    loaded.endpoint,
  );
  const path = join(f.directory, "private/runtime-policy.json");
  const authored = JSON.stringify({ ...policy, customSetting: "retained" });
  await writeFile(path, authored);
  await assert.rejects(
    prepareRuntimePolicy(
      f.directory,
      undefined,
      undefined,
      undefined,
      loaded.endpoint,
    ),
    code("configuration_changed"),
  );
  assert.equal(await readFile(path, "utf8"), authored);
  await prepareInitialConnections(f.directory, loaded);
});
await test("external endpoint defaults to public CA and verifies retained URL, network, owner and file permissions", async (t) => {
  const f = await fixture(t, { brokerUrl: "https://broker.example" });
  const loaded = await loadInitialConnections(f.state.input.connections);
  assert.ok(loaded?.mode === "external");
  assert.equal(loaded.endpoint.network.port, 443);
  assert.equal(loaded.endpoint.ca, undefined);
  await prepareInitialConnections(f.directory, loaded);
  const target = join(f.directory, "private/connections/endpoint.json");
  const original = await readFile(target);
  for (const change of [
    { ...loaded.endpoint, brokerUrl: "https://other.example" },
    { ...loaded.endpoint, network: { ...loaded.endpoint.network, port: 444 } },
    {
      ...loaded.endpoint,
      ca: await readFile(
        join(f.directory, "private/management-ca.pem"),
        "utf8",
      ),
    },
  ]) {
    await writeFile(target, JSON.stringify(change));
    await assert.rejects(
      readInitialConnectionsEndpoint(f.directory),
      code("configuration_changed"),
    );
  }
  await writeFile(target, original);
  const ownerPath = join(f.directory, "private/connections/owner.json");
  const owner = await readFile(ownerPath);
  await writeFile(
    ownerPath,
    JSON.stringify({ ownerId: randomUUID(), mode: "external" }),
  );
  await assert.rejects(
    readInitialConnectionsEndpoint(f.directory),
    code("configuration_changed"),
  );
  await writeFile(ownerPath, owner);
  await chmod(target, 0o644);
  await assert.rejects(
    readInitialConnectionsEndpoint(f.directory),
    code("configuration_changed"),
  );
  await chmod(target, 0o600);
  await rm(target);
  const outside = join(f.root, "endpoint.json");
  await writeFile(outside, original, { mode: 0o600 });
  await symlink(outside, target);
  await assert.rejects(
    readInitialConnectionsEndpoint(f.directory),
    code("configuration_changed"),
  );
});
await test("external CA validation rejects malformed, oversized and symlinked inputs before preparing anything", async (t) => {
  const f = await fixture(t, { brokerUrl: "https://broker.example" });
  const caFile = join(f.root, "trust.pem");
  const input = {
    mode: "external" as const,
    brokerUrl: "https://broker.example",
    caFile,
  };
  for (const content of ["not a certificate", "x".repeat(1024 * 1024 + 1)]) {
    await writeFile(caFile, content);
    await assert.rejects(
      loadInitialConnections(input),
      code("invalid_connections_setup"),
    );
  }
  await rm(caFile);
  await symlink(join(f.directory, "private/management-ca.pem"), caFile);
  await assert.rejects(
    loadInitialConnections(input),
    code("invalid_connections_setup"),
  );
  assert.equal(
    (await readdir(join(f.directory, "private"))).includes("connections"),
    false,
  );
});
await test(
  "initial Connections publication uses real PostgreSQL, safely repeats the same version and refuses a different retained version",
  { skip: !databaseUrl },
  async (t) => {
    assert.ok(databaseUrl);
    const f = await fixture(t);
    const loaded = await loadInitialConnections(f.input);
    assert.ok(loaded?.mode === "local");
    const admin = new Pool({ connectionString: databaseUrl });
    const database = `clawscarf_initial_catalog_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE "${database}"`);
    const url = new URL(databaseUrl);
    url.pathname = "/" + database;
    const pool = new Pool({ connectionString: url.href });
    try {
      await runner({
        databaseUrl: url.href,
        dir: fileURLToPath(
          new URL("../../services/connections/migrations", import.meta.url),
        ),
        direction: "up",
        migrationsTable: "clawscarf_connections_migrations",
        count: Infinity,
        log: () => undefined,
      });
      await Promise.all([
        publishInitialConnections(pool, loaded),
        publishInitialConnections(pool, loaded),
      ]);
      const current = await pool.query<{ version: string }>(
        "SELECT version FROM clawscarf_connections.connection_catalog_publication WHERE singleton=1",
      );
      assert.equal(current.rows[0]?.version, loaded.catalogVersion);
      for (const [path, content] of connectionCatalogFiles({
        serviceName: "Changed",
      }))
        await writeFile(join(f.input.catalogDirectory, path), content);
      const replacement = await loadInitialConnections(f.input);
      assert.ok(
        replacement?.mode === "local" &&
          replacement.catalogVersion !== loaded.catalogVersion,
      );
      await assert.rejects(
        publishInitialConnections(pool, replacement),
        code("configuration_changed"),
      );
      const retained = await pool.query<{ version: string }>(
        "SELECT version FROM clawscarf_connections.connection_catalog_publication WHERE singleton=1",
      );
      assert.equal(retained.rows[0]?.version, loaded.catalogVersion);
    } finally {
      await pool.end();
      try {
        await admin.query(`DROP DATABASE "${database}"`);
      } finally {
        await admin.end();
      }
    }
  },
);
