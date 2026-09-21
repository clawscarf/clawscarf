import { oidcTeam } from "./oidc.js";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test, type TestContext } from "node:test";
import {
  verifyLocalExecutables,
  verifyLocalPorts,
} from "../../scripts/deployment/preflight.js";
import {
  resourceNames,
  type LocalState,
} from "../../scripts/deployment/state.js";
import { LocalSetupError } from "../../scripts/deployment/process.js";

async function listener(t: TestContext, port = 0) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const close = async () => {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  };
  t.after(close);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { port: address.port, close };
}
async function fixture(t: TestContext): Promise<LocalState> {
  const ports = {
    controller: 0,
    application: 0,
    widgets: 0,
    management: 0,
    native: 0,
    nativeWidgets: 0,
    database: 0,
  };
  const reservations = [];
  for (const name of Object.keys(ports)) {
    const reservation = await listener(t);
    reservations.push(reservation);
    Object.assign(ports, { [name]: reservation.port });
  }
  for (const reservation of reservations) await reservation.close();
  return {
    schemaVersion: 1,
    ownerId: "00000000-0000-4000-8000-000000000001",
    input: {
      team: oidcTeam(ports.application, ports.widgets),
      name: "preflight",
      administratorName: "Ada",
      publicWeb: false,
      runtimeImage: `sha256:${"a".repeat(64)}`,
      companionImage: `sha256:${"b".repeat(64)}`,
      openshellCli: process.execPath,
      openshellGateway: process.execPath,
      openshellClientImage: `sha256:${"a".repeat(64)}`,
      ports,
      cpu: "2",
      memory: "2Gi",
    },
  };
}
function code(expected: string) {
  return (error: unknown) =>
    error instanceof LocalSetupError && error.code === expected;
}
await test("port probes release every free listener and reject all occupied application/controller ports without Docker writes", async (t) => {
  const state = await fixture(t);
  const noDocker = (_executable: string, args: readonly string[]) => {
    assert.deepEqual(args.slice(0, 2), ["container", "ls"]);
    return Promise.resolve("");
  };
  await verifyLocalPorts(state, noDocker);
  for (const [name, port] of Object.entries(state.input.ports)) {
    if (name === "database") continue;
    const occupied = await listener(t, port);
    await assert.rejects(
      verifyLocalPorts(state, noDocker),
      (error) =>
        code("port_in_use")(error) &&
        error instanceof Error &&
        error.message.includes(name),
    );
    await occupied.close();
  }
  await verifyLocalPorts(state, noDocker);
});
await test("an occupied database port is reusable only with exact running ownership and loopback publication", async (t) => {
  const state = await fixture(t);
  await listener(t, state.input.ports.database);
  const inspection = {
    running: true,
    owner: state.ownerId,
    project: resourceNames(state).project,
    service: "postgres",
    ports: {
      "5432/tcp": [
        { HostIp: "127.0.0.1", HostPort: String(state.input.ports.database) },
      ],
    },
  };
  let observed: unknown = inspection;
  let inventory = "a".repeat(64);
  const command = (executable: string, args: readonly string[]) => {
    assert.equal(executable, "docker");
    assert.equal(args[0], "container");
    if (args[1] === "ls") {
      assert.ok(args.includes(`label=clawscarf.installation=${state.ownerId}`));
      return Promise.resolve(inventory);
    }
    assert.equal(args[1], "inspect");
    assert.ok(!args.join(" ").includes(".Config.Env"));
    return Promise.resolve(JSON.stringify(observed));
  };
  await verifyLocalPorts(state, command);
  for (const change of [
    { running: false },
    { owner: "another-installation" },
    { project: "another-project" },
    { service: "companion" },
    {
      ports: {
        "5432/tcp": [
          { HostIp: "0.0.0.0", HostPort: String(state.input.ports.database) },
        ],
      },
    },
    { ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "1" }] } },
    { ports: null },
  ]) {
    observed = { ...inspection, ...change };
    await assert.rejects(verifyLocalPorts(state, command), code("port_in_use"));
  }
  observed = inspection;
  for (const listing of [
    "",
    "not-an-id",
    `${"a".repeat(64)}\n${"b".repeat(64)}`,
  ]) {
    inventory = listing;
    await assert.rejects(verifyLocalPorts(state, command), code("port_in_use"));
  }
});
await test("missing or non-file controller executables fail preflight", async (t) => {
  const state = await fixture(t);
  await verifyLocalExecutables(state);
  for (const path of ["/clawscarf-missing-executable", "/tmp"]) {
    state.input.openshellGateway = path;
    await assert.rejects(
      verifyLocalExecutables(state),
      code("executable_unavailable"),
    );
  }
});
