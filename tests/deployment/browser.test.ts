import { oidcTeam } from "./oidc.js";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  chmod,
  link,
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
import { LocalSetupError, type run } from "../../scripts/deployment/process.js";
import {
  browserDefaults,
  prepareBrowser,
  verifyBrowserConfiguration,
} from "../../scripts/deployment/browser.js";
import { composeConfiguration } from "../../scripts/deployment/compose.js";
import { parseLocalInput } from "../../scripts/deployment/configuration.js";
import { initialRuntimePolicy } from "../../scripts/deployment/policy.js";
import {
  resourceNames,
  type LocalState,
} from "../../scripts/deployment/state.js";

const input = {
  name: "browser-test",
  administratorName: "Ada",
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
};
const browser = {
  image: `sha256:${"c".repeat(64)}`,
  egressImage: `sha256:${"e".repeat(64)}`,
  nodeImage: `sha256:${"a".repeat(64)}`,
  dnsImage: `sha256:${"b".repeat(64)}`,
  port: 17218,
};
function state(configured = true): LocalState {
  return {
    schemaVersion: 1,
    ownerId: "00000000-0000-4000-8000-000000000001",
    input: parseLocalInput({
      ...input,
      ...(configured
        ? { browser, relayImage: `sha256:${"d".repeat(64)}` }
        : {}),
    }),
  };
}

await test("optional browser creates no service, volume, network, native policy or preparation I/O when absent", async () => {
  const installation = state(false);
  const compose = composeConfiguration(
    installation,
    "/nonexistent/browser-test",
    "172.30.0.254",
  );
  assert.deepEqual(Object.keys(compose.services).sort(), [
    "application",
    "companion",
    "controller",
    "postgres",
    "widgets",
  ]);
  assert.deepEqual(Object.keys(compose.networks), ["runtime", "default"]);
  assert.deepEqual(Object.keys(compose.volumes), ["database"]);
  assert.equal(
    await prepareBrowser("/nonexistent/browser-test", installation),
    undefined,
  );
  assert.deepEqual(
    initialRuntimePolicy("network_policies: {}", undefined).network_policies,
    {},
  );
});

await test("browser remains on the isolated bridge while only the fixed relay publishes loopback CDP", () => {
  const installation = state();
  const compose = composeConfiguration(
    installation,
    "/private/browser-test",
    "172.30.0.254",
    "10.75.2.30",
    {
      addresses: {
        node: "10.77.2.30",
        ingress: "10.77.2.29",
        dns: "10.77.2.28",
      },
      fingerprint: "ab".repeat(32),
    },
  );
  const node = compose.services["browser-node"];
  const ingress = compose.services["browser-node-ingress"];
  const dns = compose.services["browser-node-dns"];
  assert.ok(node && ingress && dns);
  for (const container of [node, ingress, dns]) {
    assert.equal("ports" in container, false);
    assert.equal(container.read_only, true);
    assert.deepEqual(container.cap_drop, ["ALL"]);
    assert.ok(container.security_opt.includes("no-new-privileges:true"));
  }
  assert.deepEqual(Object.keys(node.networks).sort(), ["browser", "machine"]);
  assert.equal(
    node.environment.CLAWSCARF_BROWSER_NODE_GATEWAY_URL,
    "wss://10.77.2.29:18803",
  );
  assert.equal(
    ingress.environment.CLAWSCARF_NODE_INGRESS_ADDRESS,
    "10.77.2.29",
  );
  assert.ok(node.volumes.includes("browser-node-config:/configuration:ro"));
  assert.equal(
    node.volumes.some((value) => /docker.sock|worker|controller/.test(value)),
    false,
  );
  assert.throws(() =>
    composeConfiguration(
      installation,
      "/private/browser-test",
      "172.30.0.254",
      "10.75.2.30",
    ),
  );
  const service = compose.services.browser;
  const relay = compose.services["browser-relay"];
  const egress = compose.services["browser-egress"];
  assert.ok(service && relay && egress);
  assert.deepEqual(Object.keys(service.networks), ["browser"]);
  assert.equal(service.networks.browser.ipv4_address, "10.75.2.30");
  assert.equal("ports" in service, false);
  assert.equal("ports" in egress, false);
  assert.deepEqual(relay.ports, [`127.0.0.1:${String(browser.port)}:9223`]);
  assert.deepEqual(Object.keys(relay.networks).sort(), ["browser", "runtime"]);
  assert.deepEqual(Object.keys(egress.networks).sort(), ["browser", "default"]);
  for (const container of [service, relay, egress]) {
    assert.equal(container.read_only, true);
    assert.deepEqual(container.cap_drop, ["ALL"]);
    assert.ok(container.security_opt.includes("no-new-privileges:true"));
    assert.equal("privileged" in container, false);
    assert.equal("network_mode" in container, false);
  }
  assert.deepEqual(relay.networks.runtime, {
    aliases: ["runtime.clawscarf.internal"],
  });
  assert.equal("extra_hosts" in relay, false);
  assert.deepEqual(relay.volumes, [
    "/private/browser-test/private/browser-relay.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro",
  ]);
  assert.equal(service.user, "1000:1000");
  assert.ok(
    service.security_opt.includes(
      "seccomp:/private/browser-test/private/browser-seccomp.json",
    ),
  );
  assert.deepEqual(service.volumes, ["browser:/state"]);
  assert.equal(
    service.environment.CLAWSCARF_BROWSER_PROXY_SERVER,
    "http://browser-egress:3128",
  );
  assert.deepEqual(egress.volumes, [
    "/private/browser-test/private/browser-source.acl:/etc/squid/browser-source.acl:ro",
  ]);
  assert.deepEqual(compose.volumes.browser, {
    external: true,
    name: resourceNames(installation).browserVolume,
  });
  assert.deepEqual(compose.networks.browser, {
    external: true,
    name: `${resourceNames(installation).project}_browser`,
  });
  assert.throws(() =>
    composeConfiguration(installation, "/private/browser-test", "172.30.0.254"),
  );
});

await test("browser profile retains a scoped credential without granting Gateway CDP egress", () => {
  const token = "f".repeat(64);
  const defaults = browserDefaults(token);
  assert.equal(defaults.allowSystemProfileImport, false);
  assert.equal(defaults.profiles.team.attachOnly, true);
  assert.equal(defaults.defaultProfile, "team");
  assert.deepEqual(defaults.ssrfPolicy, {
    allowedHostnames: ["runtime.clawscarf.internal"],
  });
  const endpoint = new URL(defaults.profiles.team.cdpUrl);
  assert.equal(endpoint.password, token);
  assert.equal(endpoint.origin, "http://runtime.clawscarf.internal:9223");
  assert.throws(() => browserDefaults("token@other-host"));
  const policy = initialRuntimePolicy(
    "network_policies: {}",
    undefined,
    undefined,
  );
  assert.deepEqual(policy.network_policies, {});
  assert.ok(
    !JSON.stringify(
      composeConfiguration(
        state(),
        "/private/browser-test",
        "172.30.0.254",
        "10.75.2.30",
        {
          addresses: {
            node: "10.77.2.30",
            ingress: "10.77.2.29",
            dns: "10.77.2.28",
          },
          fingerprint: "ab".repeat(32),
        },
      ),
    ).includes(token),
  );
});

await test("browser inputs reject mutable images and unsupported worker configuration and collisions with native listeners", () => {
  for (const key of ["image", "egressImage", "nodeImage", "dnsImage"])
    assert.throws(() =>
      parseLocalInput({
        ...input,
        relayImage: `sha256:${"d".repeat(64)}`,
        browser: { ...browser, [key]: "browser:latest" },
      }),
    );
  for (const port of Object.values(input.ports))
    assert.throws(() =>
      parseLocalInput({
        ...input,
        relayImage: `sha256:${"d".repeat(64)}`,
        browser: { ...browser, port },
      }),
    );
  assert.throws(() =>
    parseLocalInput({
      ...input,
      relayImage: `sha256:${"d".repeat(64)}`,
      browser,
      execution: {
        image: browser.image,
        port: browser.port,
        cpu: "1",
        memory: "512Mi",
      },
    }),
  );
});

async function preparationFixture(t: TestContext) {
  const directory = await mkdtemp(
    join(tmpdir(), "clawscarf-browser-configuration-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "private"), { mode: 0o700 });
  const installation = state();
  const intent = {
    ownerId: installation.ownerId,
    purpose: "browser",
    name: `${resourceNames(installation).project}_browser`,
  };
  const id = "a".repeat(64);
  for (const [suffix, value] of [
    ["create", intent],
    [
      "receipt",
      {
        ...intent,
        id,
        isolated: {
          subnet: "10.75.2.0/27",
          gateway: "10.75.2.1",
          address: "10.75.2.30",
        },
      },
    ],
  ] as const)
    await writeFile(
      join(directory, "private", `network-browser-${suffix}.json`),
      JSON.stringify(value),
      { mode: 0o600 },
    );
  const calls: string[] = [];
  const command: typeof run = (executable, args) => {
    assert.equal(executable, "docker");
    assert.equal(args[0], "network");
    calls.push(args[1] ?? "");
    if (args[1] === "ls")
      return Promise.resolve(JSON.stringify({ id, name: intent.name }));
    assert.equal(args[1], "inspect");
    return Promise.resolve(
      JSON.stringify({
        Id: id,
        Name: intent.name,
        Driver: "bridge",
        Scope: "local",
        Internal: true,
        Ingress: false,
        Attachable: false,
        EnableIPv6: false,
        Options: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" },
        Labels: {
          "clawscarf.installation": installation.ownerId,
          "clawscarf.network-purpose": "browser",
        },
        IPAM: {
          Driver: "default",
          Options: null,
          Config: [{ Subnet: "10.75.2.0/27", Gateway: "10.75.2.1" }],
        },
      }),
    );
  };
  return { directory, installation, command, calls };
}

await test("browser source rule remains readable under a restrictive umask and repeated preparation preserves credentials", async (t) => {
  const f = await preparationFixture(t);
  const previous = process.umask(0o077);
  try {
    const first = await prepareBrowser(f.directory, f.installation, f.command);
    assert.ok(first);
    assert.equal(first.address, "10.75.2.30");
    const acl = join(f.directory, "private/browser-source.acl");
    assert.equal((await lstat(acl)).mode & 0o777, 0o444);
    assert.equal(await readFile(acl, "utf8"), "10.75.2.30/32\n");
    assert.deepEqual(
      await prepareBrowser(f.directory, f.installation, f.command),
      first,
    );
    await verifyBrowserConfiguration(f.directory, f.installation, f.command);
    assert.ok(
      f.calls.every((operation) => ["ls", "inspect"].includes(operation)),
    );
  } finally {
    process.umask(previous);
  }
});

await test("startup rejects changed browser source ACL and seccomp bytes without repairing operator files", async (t) => {
  const f = await preparationFixture(t);
  await prepareBrowser(f.directory, f.installation, f.command);
  for (const [name, replacement, mode] of [
    ["browser-source.acl", "0.0.0.0/0\n", 0o444],
    ["browser-seccomp.json", '{"defaultAction":"SCMP_ACT_ALLOW"}', 0o600],
  ] as const) {
    const path = join(f.directory, "private", name);
    const original = await readFile(path);
    await chmod(path, 0o600);
    await writeFile(path, replacement);
    await chmod(path, mode);
    await assert.rejects(
      verifyBrowserConfiguration(f.directory, f.installation, f.command),
      (error: unknown) =>
        error instanceof LocalSetupError &&
        error.code === "configuration_changed",
    );
    assert.equal(await readFile(path, "utf8"), replacement);
    await chmod(path, 0o600);
    await writeFile(path, original);
    await chmod(path, mode);
  }
  await verifyBrowserConfiguration(f.directory, f.installation, f.command);
});

await test("startup refuses symlinked or multiply-linked browser isolation files and exposed tokens", async (t) => {
  const f = await preparationFixture(t);
  await prepareBrowser(f.directory, f.installation, f.command);
  const acl = join(f.directory, "private/browser-source.acl");
  const alias = join(f.directory, "private/acl-alias");
  await link(acl, alias);
  await assert.rejects(
    verifyBrowserConfiguration(f.directory, f.installation, f.command),
  );
  await rm(acl);
  await symlink(alias, acl);
  await assert.rejects(
    verifyBrowserConfiguration(f.directory, f.installation, f.command),
  );
  await rm(acl);
  await writeFile(acl, await readFile(alias), { mode: 0o444 });
  await chmod(acl, 0o444);
  const token = join(f.directory, "private/browser-token");
  await chmod(token, 0o644);
  await assert.rejects(
    verifyBrowserConfiguration(f.directory, f.installation, f.command),
  );
  assert.equal((await lstat(token)).mode & 0o777, 0o644);
  await verifyBrowserConfiguration(
    "/nonexistent/browser-test",
    state(false),
    f.command,
  );
});

await test("a pinned top-level relay image is required exactly when browser transport is enabled", () => {
  const relayImage = `sha256:${"d".repeat(64)}`;
  assert.throws(() => parseLocalInput({ ...input, browser }));
  assert.throws(() => parseLocalInput({ ...input, relayImage }));
  assert.throws(() =>
    parseLocalInput({ ...input, browser, relayImage: "relay:latest" }),
  );
  assert.throws(() =>
    parseLocalInput({
      ...input,
      browser: { ...browser, relayImage },
      relayImage,
    }),
  );
  assert.equal(
    parseLocalInput({ ...input, browser, relayImage }).relayImage,
    relayImage,
  );
});
