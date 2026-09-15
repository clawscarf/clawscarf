import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  relayConfiguration,
  prepareRelay,
  verifyRelayConfiguration,
} from "../../scripts/local/relay.js";
import { parseLocalInput } from "../../scripts/local/configuration.js";
import { resourceNames, type LocalState } from "../../scripts/local/state.js";
import { LocalSetupError, type run } from "../../scripts/local/process.js";

function state(execution = true, browser = true): LocalState {
  return {
    schemaVersion: 1,
    ownerId: "00000000-0000-4000-8000-000000000001",
    input: parseLocalInput({
      name: "relay-test",
      administratorName: "Ada",
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
      ...(execution || browser
        ? { relayImage: `sha256:${"c".repeat(64)}` }
        : {}),
      ...(execution
        ? {
            execution: {
              image: `sha256:${"d".repeat(64)}`,
              port: 17218,
              cpu: "1",
              memory: "2Gi",
            },
          }
        : {}),
      ...(browser
        ? {
            browser: {
              image: `sha256:${"e".repeat(64)}`,
              egressImage: `sha256:${"f".repeat(64)}`,
              nodeImage: `sha256:${"a".repeat(64)}`,
              dnsImage: `sha256:${"b".repeat(64)}`,
              port: 17219,
            },
          }
        : {}),
    }),
  };
}
function changed(error: unknown) {
  return (
    error instanceof LocalSetupError && error.code === "configuration_changed"
  );
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-relay-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "private"), { mode: 0o700 });
  const installation = state();
  const intent = {
    ownerId: installation.ownerId,
    purpose: "runtime",
    name: resourceNames(installation).sandbox,
  };
  const id = "a".repeat(64);
  for (const [suffix, value] of [
    ["create", intent],
    [
      "receipt",
      {
        ...intent,
        id,
        relay: {
          subnet: "10.76.2.0/27",
          gateway: "10.76.2.1",
          address: "10.76.2.30",
        },
      },
    ],
  ] as const)
    await writeFile(
      join(directory, "private", `network-runtime-${suffix}.json`),
      JSON.stringify(value),
      { mode: 0o600 },
    );
  const command: typeof run = (executable, args) => {
    assert.equal(executable, "docker");
    assert.equal(args[0], "network");
    if (args[1] === "ls")
      return Promise.resolve(JSON.stringify({ id, name: intent.name }));
    assert.equal(
      args[1],
      "inspect",
      "Relay verification must not mutate Docker",
    );
    return Promise.resolve(
      JSON.stringify({
        Id: id,
        Name: intent.name,
        Driver: "bridge",
        Scope: "local",
        Internal: false,
        Ingress: false,
        Attachable: true,
        EnableIPv6: false,
        Options: null,
        Labels: {
          "clawscarf.installation": installation.ownerId,
          "clawscarf.network-purpose": "runtime",
        },
        IPAM: {
          Driver: "default",
          Options: null,
          Config: [{ Subnet: "10.76.2.0/27", Gateway: "10.76.2.1" }],
        },
      }),
    );
  };
  return { directory, installation, command };
}

await test("relay binds SSH only on its runtime address and defines only the selected fixed TCP destinations", () => {
  const both = relayConfiguration(state(), "10.76.2.30");
  assert.match(
    both,
    /listen execution\n {2}bind 10\.76\.2\.30:2222\n {2}server worker host\.docker\.internal:17218 /,
  );
  assert.match(
    both,
    /listen browser\n {2}bind :9223\n {2}server browser browser:9223 /,
  );
  assert.doesNotMatch(both, /bind (?:\*|0\.0\.0\.0)?:2222/);
  assert.doesNotMatch(
    both,
    /mode http|http-request|http-response|socks|forwardfor/i,
  );
  assert.doesNotMatch(
    relayConfiguration(state(false, true), "10.76.2.30"),
    /listen execution|:2222|host\.docker\.internal/,
  );
  assert.doesNotMatch(
    relayConfiguration(state(true, false), "10.76.2.30"),
    /listen browser|:9223/,
  );
  assert.throws(() =>
    relayConfiguration(state(), "10.76.2.30\n {2}bind :2222"),
  );
});

await test("relay preparation is optional and observes its owned runtime address without allocating resources", async (t) => {
  const f = await fixture(t);
  const noCommand: typeof run = () => {
    throw Error("Unexpected Docker command");
  };
  assert.equal(
    await prepareRelay("/does-not-exist", state(false, false), noCommand),
    undefined,
  );
  await verifyRelayConfiguration(
    "/does-not-exist",
    state(false, false),
    noCommand,
  );
  const previous = process.umask(0o077);
  try {
    assert.equal(
      await prepareRelay(f.directory, f.installation, f.command),
      "10.76.2.30",
    );
    const path = join(f.directory, "private/runtime-relay.cfg");
    assert.equal((await lstat(path)).mode & 0o777, 0o444);
    const content = await readFile(path, "utf8");
    await verifyRelayConfiguration(f.directory, f.installation, f.command);
    assert.equal(
      await prepareRelay(f.directory, f.installation, f.command),
      "10.76.2.30",
    );
    assert.equal(await readFile(path, "utf8"), content);
  } finally {
    process.umask(previous);
  }
});

await test("relay restart refuses broadened SSH binding or substituted configuration without repair", async (t) => {
  const f = await fixture(t);
  await prepareRelay(f.directory, f.installation, f.command);
  const path = join(f.directory, "private/runtime-relay.cfg");
  const original = await readFile(path, "utf8");
  const broadened = original.replace("bind 10.76.2.30:2222", "bind :2222");
  assert.notEqual(broadened, original);
  await chmod(path, 0o600);
  await writeFile(path, broadened);
  await chmod(path, 0o444);
  await assert.rejects(
    verifyRelayConfiguration(f.directory, f.installation, f.command),
    changed,
  );
  await assert.rejects(
    prepareRelay(f.directory, f.installation, f.command),
    changed,
  );
  assert.equal(await readFile(path, "utf8"), broadened);
  await rm(path);
  const alternate = join(f.directory, "private/other-relay.cfg");
  await writeFile(alternate, original, { mode: 0o444 });
  await symlink(alternate, path);
  await assert.rejects(
    verifyRelayConfiguration(f.directory, f.installation, f.command),
    changed,
  );
});
