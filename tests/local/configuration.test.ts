import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateLocalConfiguration,
  parseLocalInput,
} from "../../scripts/local/configuration.js";

const base = {
  name: "my-team",
  administratorName: "Ada Lovelace",
  runtimeImage: `sha256:${"a".repeat(64)}`,
  companionImage: `ghcr.io/example/companion@sha256:${"b".repeat(64)}`,
  openshellCli: "/tools/openshell",
  openshellGateway: "/tools/openshell-gateway",
  ports: {
    controller: 17671,
    application: 19000,
    widgets: 19002,
    management: 19001,
    native: 19789,
    nativeWidgets: 19790,
    database: 15432,
  },
  cpu: "2",
  memory: "2Gi",
};
function generate(
  overrides: Partial<Parameters<typeof generateLocalConfiguration>[0]> = {},
) {
  return generateLocalConfiguration({
    input: parseLocalInput(base),
    directory: "/private/team",
    encryptionKeyPath: "/private/team/encryption.key",
    managementCertificatePath: "/private/team/management-cert.pem",
    managementKeyPath: "/private/team/management-key.pem",
    runtimeDatabaseUrl: "postgres://runtime:private@database:5432/clawscarf",
    administratorIdentity: "clawscarf:00000000-0000-4000-8000-000000000001",
    ...overrides,
  });
}
await test("local inputs reject mutable images, relative executables and public identity/network options", () => {
  for (const change of [
    { runtimeImage: "example/runtime:latest" },
    { companionImage: `image@sha256:${"x".repeat(64)}` },
    { openshellCli: "openshell" },
    { openshellGateway: "../gateway" },
    { name: "Uppercase" },
    { name: "a".repeat(31) },
    { name: "bad--slug" },
    { administratorName: "  " },
    { administratorName: "A\nB" },
    { origin: "https://team.example" },
    { identity: { mode: "oidc" } },
    { connections: {} },
    { models: { configurationFile: "relative", runtimeKeyFile: "/key" } },
    { models: { configurationFile: "/config", runtimeKeyFile: "relative" } },
    {
      models: {
        configurationFile: "/config",
        runtimeKeyFile: "/key",
        caFile: "relative",
      },
    },
    {
      models: {
        configurationFile: "/config",
        runtimeKeyFile: "/key",
        token: "inline",
      },
    },
    { cpu: "0" },
    { cpu: "0m" },
    { cpu: "unlimited" },
    { memory: "0Gi" },
    { ports: { ...base.ports, widgets: base.ports.application } },
    { ports: { ...base.ports, controller: "17671" } },
    { ports: { ...base.ports, database: 65536 } },
  ])
    assert.throws(() => parseLocalInput({ ...base, ...change }));
  assert.equal(parseLocalInput({ ...base, cpu: "500m" }).cpu, "500m");
  assert.equal(parseLocalInput({ ...base, cpu: "0.5" }).cpu, "0.5");
});
await test("generated configuration separates public, container and native listeners without reading keys", () => {
  const result = generate();
  assert.equal(result.access.origin, "http://127.0.0.1:19000");
  assert.equal(result.access.port, 18800);
  assert.equal(
    result.access.runtime.managementOrigin,
    "https://host.docker.internal:19001",
  );
  assert.equal(result.access.managementTls?.port, 18801);
  assert.equal(
    result.access.runtime.origin,
    "http://host.docker.internal:19789",
  );
  assert.equal(
    result.access.runtime.widgetUpstream,
    "http://host.docker.internal:19790",
  );
  assert.equal(result.access.runtime.widgetOrigin, "http://127.0.0.1:19002");
  assert.equal(result.native.gateway.port, 19789);
  assert.equal(result.native.mcp.apps.sandboxPort, 19790);
  assert.equal(result.native.gateway.publicOrigin, result.access.origin);
  assert.equal(
    result.native.mcp.apps.sandboxOrigin,
    result.access.runtime.widgetOrigin,
  );
  assert.deepEqual(result.native.gateway.auth.trustedProxy.allowUsers, [
    "clawscarf:00000000-0000-4000-8000-000000000001",
  ]);
  assert.equal(
    result.access.encryptionKeyFile,
    "/run/clawscarf/encryption.key",
  );
  assert.equal(
    result.access.managementTls?.certificateFile,
    "/run/clawscarf/management-cert.pem",
  );
  assert.equal(
    result.access.managementTls?.keyFile,
    "/run/clawscarf/management-key.pem",
  );
  assert.equal(result.access.containerLoopbackPublication, true);
  assert.deepEqual(result.access.identity, {
    mode: "local",
    name: "Ada Lovelace",
  });
  assert.deepEqual(result.companion, {
    accessConfigurationFile: "/run/clawscarf/access.json",
  });
});
await test("local generation refuses an unrelated private mount or externally supplied identity", () => {
  assert.throws(() =>
    generate({ encryptionKeyPath: "/elsewhere/encryption.key" }),
  );
  assert.throws(() =>
    generate({ managementKeyPath: "/private/team/other.pem" }),
  );
  assert.throws(() => generate({ directory: "relative" }));
  assert.throws(() =>
    generate({ administratorIdentity: "external@example.com" }),
  );
  assert.throws(() =>
    generate({ runtimeDatabaseUrl: "https://database.example" }),
  );
});
