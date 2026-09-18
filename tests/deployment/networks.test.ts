import { oidcTeam } from "./oidc.js";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  lstat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  ensureLocalNetworks,
  verifyLocalNetworks,
  observedBrowserAddress,
  observedBrowserMachineAddresses,
  observedRelayAddress,
} from "../../scripts/deployment/networks.js";
import { LocalSetupError } from "../../scripts/deployment/process.js";
import {
  resourceNames,
  type LocalState,
} from "../../scripts/deployment/state.js";

const state: LocalState = {
  schemaVersion: 1,
  ownerId: "00000000-0000-4000-8000-000000000001",
  input: {
    name: "network-test",
    administratorName: "Ada",
    runtimeImage: `sha256:${"a".repeat(64)}`,
    companionImage: `sha256:${"b".repeat(64)}`,
    openshellCli: "/tools/openshell",
    openshellGateway: "/tools/openshell-gateway",
    openshellClientImage: `sha256:${"a".repeat(64)}`,
    team: oidcTeam(18800, 18802),
    ports: {
      controller: 17671,
      application: 18800,
      widgets: 18802,
      management: 18801,
      native: 18789,
      nativeWidgets: 18790,
      database: 15432,
    },
    cpu: "2",
    memory: "2Gi",
  },
};
function expected(purpose: "companion" | "runtime" | "browser" | "machine") {
  const names = resourceNames(state);
  return {
    ownerId: state.ownerId,
    purpose,
    name:
      purpose === "companion"
        ? `${names.project}_default`
        : ["browser", "machine"].includes(purpose)
          ? `${names.project}_${purpose}`
          : names.sandbox,
  };
}
function network(
  purpose: "companion" | "runtime" | "browser" | "machine",
  id: string,
) {
  return {
    Id: id,
    Name: expected(purpose).name,
    Driver: "bridge",
    Scope: "local",
    Internal: ["browser", "machine"].includes(purpose),
    Ingress: false,
    Attachable: purpose === "runtime",
    EnableIPv6: false,
    // Observed on freshly allocated Docker Desktop bridges; no custom options.
    Options: {
      "com.docker.network.enable_ipv4": "true",
      "com.docker.network.enable_ipv6": "false",
      ...(["browser", "machine"].includes(purpose)
        ? { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" }
        : {}),
    },
    Labels: {
      "clawscarf.installation": state.ownerId,
      "clawscarf.network-purpose": purpose,
    },
    IPAM: {
      Driver: "default",
      Options: null,
      Config: [{ Subnet: "172.29.0.0/24", Gateway: "172.29.0.1" }],
    },
  };
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-networks-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "private"), { mode: 0o700 });
  const networks = new Map<string, ReturnType<typeof network>>();
  const behavior = {
    failure: "none",
    failPurpose: "runtime",
    brokenInventory: false,
  };
  const creates: string[] = [];
  const commands: string[] = [];
  const command = async (executable: string, args: readonly string[]) => {
    assert.equal(executable, "docker");
    assert.equal(args[0], "network");
    commands.push(args[1] ?? "");
    if (args[1] === "ls") {
      if (behavior.brokenInventory) return "not JSON";
      return [...networks.values()]
        .map((value) => JSON.stringify({ id: value.Id, name: value.Name }))
        .join("\n");
    }
    if (args[1] === "inspect") {
      const found = networks.get(args.at(-1) ?? "");
      if (!found) throw Error("network unavailable");
      return JSON.stringify(found);
    }
    assert.equal(args[1], "create");
    const purpose =
      args.at(-1) === expected("runtime").name
        ? "runtime"
        : args.at(-1) === expected("browser").name
          ? "browser"
          : args.at(-1) === expected("machine").name
            ? "machine"
            : "companion";
    creates.push(purpose);
    const marker = join(directory, "private", `network-${purpose}-create.json`);
    assert.deepEqual(
      JSON.parse(await readFile(marker, "utf8")),
      expected(purpose),
    );
    assert.equal((await lstat(marker)).mode & 0o777, 0o600);
    assert.ok(args.includes(`clawscarf.installation=${state.ownerId}`));
    assert.ok(args.includes(`clawscarf.network-purpose=${purpose}`));
    assert.equal(args.includes("--attachable"), purpose === "runtime");
    assert.equal(
      args.includes("--internal"),
      ["browser", "machine"].includes(purpose),
    );
    assert.equal(
      args.includes("com.docker.network.bridge.gateway_mode_ipv4=isolated"),
      ["browser", "machine"].includes(purpose),
    );
    assert.ok(!args.includes("--subnet") && !args.includes("--gateway"));
    if (purpose === behavior.failPurpose && behavior.failure === "before")
      throw Error("external error containing a secret");
    const id = String(creates.length).repeat(64);
    networks.set(id, network(purpose, id));
    if (purpose === behavior.failPurpose && behavior.failure === "after")
      throw Error("lost response containing a secret");
    return id;
  };
  return { directory, networks, behavior, creates, commands, command };
}
function code(expectedCode: string) {
  return (error: unknown) =>
    error instanceof LocalSetupError &&
    error.code === expectedCode &&
    !error.message.includes("secret");
}

await test("actual network intents precede allocation; repeat preparation and verification retain exact IDs without mutations", async (t) => {
  const f = await fixture(t);
  const unrelated = {
    ...network("companion", "f".repeat(64)),
    Name: "another-project",
    Driver: "overlay",
  };
  f.networks.set(unrelated.Id, unrelated);
  await assert.rejects(
    verifyLocalNetworks(f.directory, state, f.command),
    code("network_unprepared"),
  );
  assert.deepEqual(f.commands, []);
  await ensureLocalNetworks(f.directory, state, f.command);
  assert.deepEqual(f.creates, ["companion", "runtime"]);
  assert.deepEqual(f.networks.get(unrelated.Id), unrelated);
  for (const purpose of ["companion", "runtime"] as const) {
    const path = join(
      f.directory,
      "private",
      `network-${purpose}-receipt.json`,
    );
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      ...expected(purpose),
      id: purpose === "companion" ? "1".repeat(64) : "2".repeat(64),
    });
  }
  await ensureLocalNetworks(f.directory, state, f.command);
  await verifyLocalNetworks(f.directory, state, f.command);
  assert.deepEqual(f.creates, ["companion", "runtime"]);
  assert.ok(
    f.commands.every((value) => ["ls", "inspect", "create"].includes(value)),
  );
});

await test("lost create responses reconcile observed ownership, while absent uncertain allocation never replays or removes the first reservation", async (t) => {
  const lost = await fixture(t);
  lost.behavior.failure = "after";
  await ensureLocalNetworks(lost.directory, state, lost.command);
  await verifyLocalNetworks(lost.directory, state, lost.command);
  assert.equal(lost.creates.length, 2);
  const absent = await fixture(t);
  absent.behavior.failure = "before";
  await assert.rejects(
    ensureLocalNetworks(absent.directory, state, absent.command),
    code("network_outcome_unknown"),
  );
  assert.equal(absent.networks.size, 1);
  assert.equal(absent.creates.length, 2);
  absent.behavior.failure = "none";
  await assert.rejects(
    ensureLocalNetworks(absent.directory, state, absent.command),
    code("network_outcome_unknown"),
  );
  await assert.rejects(
    verifyLocalNetworks(absent.directory, state, absent.command),
    code("network_unprepared"),
  );
  assert.equal(absent.creates.length, 2);
  assert.deepEqual((await readdir(join(absent.directory, "private"))).sort(), [
    "network-companion-create.json",
    "network-companion-receipt.json",
    "network-runtime-create.json",
  ]);
});

await test("recorded attempts can reconcile later observation but never adopt unrecorded existing networks", async (t) => {
  const f = await fixture(t);
  f.networks.set("a".repeat(64), network("companion", "a".repeat(64)));
  await assert.rejects(
    ensureLocalNetworks(f.directory, state, f.command),
    code("network_identity_changed"),
  );
  assert.equal(f.creates.length, 0);
  await writeFile(
    join(f.directory, "private", "network-companion-create.json"),
    JSON.stringify(expected("companion")),
    { mode: 0o600 },
  );
  await ensureLocalNetworks(f.directory, state, f.command);
  assert.deepEqual(f.creates, ["runtime"]);
  await verifyLocalNetworks(f.directory, state, f.command);
});

await test("foreign ownership, altered topology, duplicate names and replacement IDs are rejected without allocation", async (t) => {
  const f = await fixture(t);
  await ensureLocalNetworks(f.directory, state, f.command);
  const id = "1".repeat(64);
  for (const change of [
    { Driver: "overlay" },
    { Scope: "swarm" },
    { Internal: true },
    { Ingress: true },
    { Attachable: true },
    { EnableIPv6: true },
    { Options: { "com.docker.network.bridge.enable_icc": "false" } },
    { Options: { "com.docker.network.enable_ipv4": "false" } },
    { Options: { "com.docker.network.enable_ipv6": "true" } },
    {
      Labels: {
        "clawscarf.installation": "foreign",
        "clawscarf.network-purpose": "companion",
      },
    },
    {
      Labels: {
        "clawscarf.installation": state.ownerId,
        "clawscarf.network-purpose": "runtime",
      },
    },
    {
      IPAM: { Driver: "default", Options: null, Config: [{ Gateway: "::1" }] },
    },
  ]) {
    f.networks.set(id, Object.assign(network("companion", id), change));
    await assert.rejects(
      verifyLocalNetworks(f.directory, state, f.command),
      code("network_identity_changed"),
    );
  }
  f.networks.set(id, network("companion", id));
  f.networks.set("a".repeat(64), network("companion", "a".repeat(64)));
  await assert.rejects(
    ensureLocalNetworks(f.directory, state, f.command),
    code("network_identity_changed"),
  );
  f.networks.delete(id);
  await assert.rejects(
    ensureLocalNetworks(f.directory, state, f.command),
    code("network_identity_changed"),
  );
  f.networks.delete("a".repeat(64));
  await assert.rejects(
    ensureLocalNetworks(f.directory, state, f.command),
    code("network_outcome_unknown"),
  );
  assert.equal(f.creates.length, 2);
});

await test("incomplete Docker observation cannot establish absence or dispatch allocation", async (t) => {
  const f = await fixture(t);
  f.behavior.brokenInventory = true;
  await assert.rejects(
    ensureLocalNetworks(f.directory, state, f.command),
    code("network_lookup_incomplete"),
  );
  assert.deepEqual(f.creates, []);
  assert.deepEqual(await readdir(join(f.directory, "private")), []);
});

await test("missing, changed or nonprivate receipt records cannot authorize startup", async (t) => {
  const f = await fixture(t);
  await ensureLocalNetworks(f.directory, state, f.command);
  const path = join(f.directory, "private", "network-companion-receipt.json");
  const receipt = await readFile(path, "utf8");
  await writeFile(
    path,
    JSON.stringify({
      ...expected("companion"),
      ownerId: "00000000-0000-4000-8000-000000000099",
      id: "1".repeat(64),
    }),
  );
  await assert.rejects(
    verifyLocalNetworks(f.directory, state, f.command),
    code("network_identity_changed"),
  );
  await rm(path);
  await assert.rejects(
    verifyLocalNetworks(f.directory, state, f.command),
    code("network_unprepared"),
  );
  await writeFile(path, receipt, { mode: 0o644 });
  await assert.rejects(
    verifyLocalNetworks(f.directory, state, f.command),
    code("network_identity_changed"),
  );
  assert.equal(f.creates.length, 2);
});

function browserState(): LocalState {
  return {
    ...state,
    input: {
      ...state.input,
      relayImage: `sha256:${"d".repeat(64)}`,
      browser: {
        image: `sha256:${"c".repeat(64)}`,
        egressImage: `sha256:${"e".repeat(64)}`,
        nodeImage: `sha256:${"a".repeat(64)}`,
        dnsImage: `sha256:${"b".repeat(64)}`,
        port: 19223,
      },
    },
  };
}
await test("browser reserves only its own isolated bridge and pins an address from observed Docker IPAM", async (t) => {
  const f = await fixture(t);
  const configured = browserState();
  await ensureLocalNetworks(f.directory, configured, f.command);
  assert.deepEqual(f.creates, ["companion", "runtime", "browser", "machine"]);
  const address = await observedBrowserAddress(
    f.directory,
    configured,
    f.command,
  );
  assert.equal(address, "172.29.0.254");
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(f.directory, "private/network-browser-receipt.json"),
        "utf8",
      ),
    ),
    {
      ...expected("browser"),
      id: "3".repeat(64),
      isolated: { subnet: "172.29.0.0/24", gateway: "172.29.0.1", address },
    },
  );
  await ensureLocalNetworks(f.directory, configured, f.command);
  await verifyLocalNetworks(f.directory, configured, f.command);
  assert.equal(f.creates.length, 4);
  f.commands.length = 0;
  assert.equal(
    await observedBrowserAddress(f.directory, state, f.command),
    undefined,
  );
  assert.deepEqual(f.commands, []);
});
await test("browser isolation and IPAM drift cannot change the saved address or authorize startup", async (t) => {
  const f = await fixture(t);
  const configured = browserState();
  await ensureLocalNetworks(f.directory, configured, f.command);
  const id = "3".repeat(64);
  for (const change of [
    { Internal: false },
    { Attachable: true },
    { EnableIPv6: true },
    { Options: null },
    { Options: { "com.docker.network.bridge.gateway_mode_ipv4": "nat" } },
    {
      Options: {
        "com.docker.network.bridge.gateway_mode_ipv4": "isolated",
        "com.docker.network.enable_ipv6": "true",
      },
    },
    ...[
      [{ Subnet: "172.30.0.0/24", Gateway: "172.30.0.1" }],
      [{ Subnet: "172.29.0.0/24", Gateway: "172.29.0.2" }],
      [{ Subnet: "172.29.0.0/24", Gateway: "172.29.0.254" }],
      [{ Subnet: "172.29.0.0/24", Gateway: "10.0.0.1" }],
      [{ Subnet: "172.29.0.1/24", Gateway: "172.29.0.2" }],
      [{ Subnet: "172.29.0.0/30", Gateway: "172.29.0.1" }],
      [{ Subnet: "8.8.8.0/24", Gateway: "8.8.8.1" }],
      [{ Subnet: "fd00::/64" }],
      [{ Subnet: "invalid" }],
      [{ Subnet: "172.29.0.0/24", IPRange: "172.29.0.128/25" }],
      [
        {
          Subnet: "172.29.0.0/24",
          Gateway: "172.29.0.1",
          AuxiliaryAddresses: { reserved: "172.29.0.254" },
        },
      ],
      [{ Subnet: "172.29.0.0/24" }, { Subnet: "10.0.0.0/24" }],
      [],
    ].map((Config) => ({ IPAM: { Driver: "default", Options: null, Config } })),
  ]) {
    f.networks.set(id, Object.assign(network("browser", id), change));
    await assert.rejects(
      observedBrowserAddress(f.directory, configured, f.command),
      code("network_identity_changed"),
    );
    await assert.rejects(
      verifyLocalNetworks(f.directory, configured, f.command),
      code("network_identity_changed"),
    );
  }
  assert.equal(f.creates.length, 4);
});
await test("browser receipts remain required and cannot be substituted or edited", async (t) => {
  const f = await fixture(t);
  const configured = browserState();
  await ensureLocalNetworks(f.directory, configured, f.command);
  const path = join(f.directory, "private/network-browser-receipt.json");
  const original = await readFile(path, "utf8");
  for (const browser of [
    undefined,
    { subnet: "172.29.0.0/24", gateway: "172.29.0.1", address: "172.29.0.253" },
  ]) {
    await writeFile(
      path,
      JSON.stringify({
        ...expected("browser"),
        id: "3".repeat(64),
        isolated: browser,
      }),
    );
    await assert.rejects(
      observedBrowserAddress(f.directory, configured, f.command),
      code("network_identity_changed"),
    );
  }
  await rm(path);
  await assert.rejects(
    observedBrowserAddress(f.directory, configured, f.command),
    code("network_unprepared"),
  );
  await writeFile(path, original, { mode: 0o644 });
  await assert.rejects(
    observedBrowserAddress(f.directory, configured, f.command),
    code("network_identity_changed"),
  );
  assert.equal(f.creates.length, 4);
});
await test("lost browser allocation response reconciles once and absent uncertain browser creates are never replayed", async (t) => {
  for (const failure of ["before", "after"]) {
    const f = await fixture(t);
    const configured = browserState();
    f.behavior.failPurpose = "browser";
    f.behavior.failure = failure;
    if (failure === "after") {
      await ensureLocalNetworks(f.directory, configured, f.command);
      assert.equal(
        await observedBrowserAddress(f.directory, configured, f.command),
        "172.29.0.254",
      );
    } else {
      for (let attempt = 0; attempt < 2; attempt++)
        await assert.rejects(
          ensureLocalNetworks(f.directory, configured, f.command),
          code("network_outcome_unknown"),
        );
      assert.equal(f.networks.size, 2);
    }
    assert.equal(f.creates.length, failure === "after" ? 4 : 3);
  }
});
await test("browser address follows a private Docker subnet of a different size without supplying allocation ranges", async (t) => {
  const f = await fixture(t);
  const configured = browserState();
  const command: typeof f.command = async (executable, args) => {
    const result = await f.command(executable, args);
    if (args[1] === "create" && args.at(-1) === expected("browser").name) {
      const observed = f.networks.get(result);
      assert.ok(observed);
      observed.IPAM.Config = [{ Subnet: "10.75.2.0/27", Gateway: "10.75.2.1" }];
    }
    return result;
  };
  await ensureLocalNetworks(f.directory, configured, command);
  assert.equal(
    await observedBrowserAddress(f.directory, configured, command),
    "10.75.2.30",
  );
});

await test("runtime relay pins its own static address independently of the isolated browser and observes it without mutations", async (t) => {
  const f = await fixture(t);
  const configured = browserState();
  const command: typeof f.command = async (executable, args) => {
    const result = await f.command(executable, args);
    if (args[1] === "create" && args.at(-1) === expected("runtime").name) {
      const observed = f.networks.get(result);
      assert.ok(observed);
      observed.IPAM.Config = [{ Subnet: "10.76.2.0/27", Gateway: "10.76.2.1" }];
    }
    return result;
  };
  await ensureLocalNetworks(f.directory, configured, command);
  assert.equal(
    await observedRelayAddress(f.directory, configured, command),
    "10.76.2.30",
  );
  assert.equal(
    await observedBrowserAddress(f.directory, configured, command),
    "172.29.0.254",
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(f.directory, "private/network-runtime-receipt.json"),
        "utf8",
      ),
    ),
    {
      ...expected("runtime"),
      id: "2".repeat(64),
      relay: {
        subnet: "10.76.2.0/27",
        gateway: "10.76.2.1",
        address: "10.76.2.30",
      },
    },
  );
  await verifyLocalNetworks(f.directory, configured, command);
  await ensureLocalNetworks(f.directory, configured, command);
  assert.equal(f.creates.length, 4);
  f.commands.length = 0;
  assert.equal(
    await observedRelayAddress(f.directory, state, command),
    undefined,
  );
  assert.deepEqual(f.commands, []);
});

await test("runtime relay rejects changed network topology, IPAM or receipt instead of rebinding SSH", async (t) => {
  const f = await fixture(t);
  const configured = browserState();
  await ensureLocalNetworks(f.directory, configured, f.command);
  const id = "2".repeat(64);
  for (const change of [
    { Internal: true },
    { Attachable: false },
    { EnableIPv6: true },
    { Options: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" } },
    {
      IPAM: {
        Driver: "default",
        Options: null,
        Config: [{ Subnet: "10.75.0.0/16", Gateway: "10.75.0.1" }],
      },
    },
    {
      IPAM: {
        Driver: "default",
        Options: null,
        Config: [{ Subnet: "172.29.0.0/24", Gateway: "172.29.0.254" }],
      },
    },
    {
      IPAM: {
        Driver: "default",
        Options: null,
        Config: [
          {
            Subnet: "172.29.0.0/24",
            Gateway: "172.29.0.1",
            IPRange: "172.29.0.128/25",
          },
        ],
      },
    },
  ]) {
    f.networks.set(id, Object.assign(network("runtime", id), change));
    await assert.rejects(
      observedRelayAddress(f.directory, configured, f.command),
      code("network_identity_changed"),
    );
    await assert.rejects(
      verifyLocalNetworks(f.directory, configured, f.command),
      code("network_identity_changed"),
    );
  }
  f.networks.set(id, network("runtime", id));
  const path = join(f.directory, "private/network-runtime-receipt.json");
  for (const relay of [
    undefined,
    { subnet: "172.29.0.0/24", gateway: "172.29.0.1", address: "172.29.0.253" },
  ]) {
    await writeFile(
      path,
      JSON.stringify({ ...expected("runtime"), id, relay }),
    );
    await assert.rejects(
      observedRelayAddress(f.directory, configured, f.command),
      code("network_identity_changed"),
    );
    await assert.rejects(
      ensureLocalNetworks(f.directory, configured, f.command),
      code("network_identity_changed"),
    );
  }
  await rm(path);
  await assert.rejects(
    observedRelayAddress(f.directory, configured, f.command),
    code("network_unprepared"),
  );
  assert.equal(f.creates.length, 4);
});

await test("machine addresses are independently pinned and never reallocated after receipt drift", async (t) => {
  const f = await fixture(t);
  const configured = browserState();
  await ensureLocalNetworks(f.directory, configured, f.command);
  assert.deepEqual(
    await observedBrowserMachineAddresses(f.directory, configured, f.command),
    {
      node: "172.29.0.254",
      ingress: "172.29.0.253",
      dns: "172.29.0.252",
    },
  );
  const path = join(f.directory, "private/network-machine-receipt.json");
  await rm(path);
  await assert.rejects(
    observedBrowserMachineAddresses(f.directory, configured, f.command),
    code("network_unprepared"),
  );
  assert.equal(f.creates.length, 4);
});
