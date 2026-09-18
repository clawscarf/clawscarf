import { oidcTeam } from "./oidc.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  loadInitialConnections,
  prepareInitialConnections,
  readInitialConnectionsEndpoint,
} from "../../scripts/deployment/connections.js";
import { initializeState } from "../../scripts/deployment/state.js";
import { parseLocalInput } from "../../scripts/deployment/configuration.js";
import { ensureCertificates } from "../../scripts/deployment/certificates.js";
import { composeConfiguration } from "../../scripts/deployment/compose.js";
import {
  initialRuntimePolicy,
  prepareRuntimePolicy,
} from "../../scripts/deployment/policy.js";
import { LocalSetupError } from "../../scripts/deployment/process.js";

async function fixture(
  t: TestContext,
  external: { brokerUrl: string; ca?: boolean },
) {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-local-connections-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "installation");
  const state = await initializeState(
    directory,
    parseLocalInput({
      name: "connections-test",
      administratorName: "Ada",
      connections: {
        mode: "external",
        brokerUrl: external.brokerUrl,
        ...(external.ca
          ? { caFile: join(directory, "private/management-ca.pem") }
          : {}),
      },
      runtimeImage: `sha256:${"a".repeat(64)}`,
      companionImage: `sha256:${"b".repeat(64)}`,
      openshellCli: "/tools/openshell",
      openshellGateway: "/tools/gateway",
      openshellClientImage: `sha256:${"a".repeat(64)}`,
      cpu: "1",
      memory: "2Gi",
      team: oidcTeam(17212, 17213),
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
  return { root, directory, state };
}
function code(expected: string) {
  return (error: unknown) =>
    error instanceof LocalSetupError &&
    error.code === expected &&
    !error.message.includes("private-provider-key");
}
await test("disabled Connections prepares no files or service", async () => {
  assert.equal(await loadInitialConnections(undefined), undefined);
  assert.equal(
    await prepareInitialConnections("/does-not-exist", undefined),
    undefined,
  );
});
await test("external Connections retains only endpoint and CA, never reads provider inputs or contacts the local database", async (t) => {
  const f = await fixture(t, {
    brokerUrl: "https://broker.example:9443/customer/team/",
    ca: true,
  });
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
    loaded.endpoint,
  );
  const path = join(f.directory, "private/runtime-policy.json");
  const authored = JSON.stringify({ ...policy, customSetting: "retained" });
  await writeFile(path, authored);
  await assert.rejects(
    prepareRuntimePolicy(f.directory, undefined, undefined, loaded.endpoint),
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
