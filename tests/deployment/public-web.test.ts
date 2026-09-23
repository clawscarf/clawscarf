import assert from "node:assert/strict";
import { BlockList, isIP } from "node:net";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialRuntimePolicy } from "../../scripts/deployment/policy.js";
import {
  composeNetworkRules,
  publicWebAddresses,
  publicWebPolicy,
} from "../../scripts/deployment/public-web.js";
import {
  stageNetworkPolicyChange,
  planNetworkPolicyChange,
  applyNetworkPolicy,
} from "../../scripts/deployment/network-policy.js";
import {
  resourceNames,
  type LocalState,
} from "../../scripts/deployment/state.js";
import { parseLocalInput } from "../../scripts/deployment/configuration.js";

await test("public web admits public unicast without private, metadata or transition ranges", () => {
  const allowed = new BlockList();
  for (const cidr of publicWebAddresses) {
    const [address, length] = cidr.split("/");
    assert.ok(address && length);
    allowed.addSubnet(
      address,
      Number(length),
      isIP(address) === 6 ? "ipv6" : "ipv4",
    );
  }
  for (const address of [
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "2606:4700:4700::1111",
  ])
    assert.equal(
      allowed.check(address, isIP(address) === 6 ? "ipv6" : "ipv4"),
      true,
      address,
    );
  for (const address of [
    "0.0.0.0",
    "10.1.1.1",
    "100.100.100.200",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001::1",
    "2001:db8::1",
    "2002:a00:1::",
    "3fff::1",
  ])
    assert.equal(
      allowed.check(address, isIP(address) === 6 ? "ipv6" : "ipv4"),
      false,
      address,
    );
  assert.deepEqual(publicWebPolicy(true)?.endpoints[0]?.ports, [80, 443]);
  assert.equal(publicWebPolicy(false), null);
});

await test("public-web selection only adds its own runtime policy", () => {
  const source = "network_policies: {}";
  const before = initialRuntimePolicy(source, undefined);
  const enabled = initialRuntimePolicy(source, undefined, undefined, true);
  assert.deepEqual(before.network_policies, {});
  assert.deepEqual(enabled.network_policies.public_web, publicWebPolicy(true));
});

await test("web toggles restore only recorded changes and preserve operator IP restrictions", () => {
  const model = {
    name: "Models",
    endpoints: [{ host: "models.example", ports: [443, 4000], tls: "skip" }],
    binaries: [{ path: "/usr/local/bin/node" }],
  };
  const strict = { model_gateway: model };
  const enabled = composeNetworkRules(
    strict,
    { public_web: publicWebPolicy(true) },
    {},
  );
  assert.deepEqual(
    composeNetworkRules(
      enabled.rules,
      { public_web: null },
      enabled.adjustments,
    ),
    { rules: strict, adjustments: {} },
  );
  assert.deepEqual(enabled.rules.model_gateway, {
    ...model,
    endpoints: [
      { host: "models.example", ports: [4000], tls: "skip" },
      {
        host: "models.example",
        ports: [443],
        tls: "skip",
        allowed_ips: publicWebAddresses,
      },
    ],
  });
  // Matching our public ranges is still an operator restriction if we never installed it.
  const restricted = {
    ...model,
    endpoints: [
      {
        host: "models.example",
        port: 443,
        tls: "skip",
        allowed_ips: publicWebAddresses,
      },
    ],
  };
  assert.deepEqual(
    composeNetworkRules({ model_gateway: restricted }, { public_web: null }, {})
      .rules.model_gateway,
    restricted,
  );
  const edited = {
    ...restricted,
    endpoints: [{ ...restricted.endpoints[0], allowed_ips: ["1.1.1.1/32"] }],
  };
  assert.deepEqual(
    composeNetworkRules(
      { ...enabled.rules, model_gateway: edited },
      { public_web: null },
      enabled.adjustments,
    ).rules.model_gateway,
    edited,
  );
  assert.throws(
    () =>
      composeNetworkRules(
        { model_gateway: edited },
        { public_web: publicWebPolicy(true) },
        {},
      ),
    /conflicts/,
  );
});

await test("Connections changes leave unrelated native endpoint shapes and model restrictions untouched", () => {
  const model = {
    endpoints: [
      {
        host: "models.example",
        ports: [4000],
        allowed_ips: publicWebAddresses,
      },
    ],
  };
  const connection = {
    endpoints: [
      {
        host: "broker.example",
        port: 443,
        tls: "skip",
        allowed_ips: ["10.0.0.1/32"],
      },
    ],
  };
  const replacement = {
    endpoints: [{ host: "broker.example", port: 443, tls: "skip" }],
  };
  assert.deepEqual(
    composeNetworkRules(
      { model_gateway: model, connections_broker: connection },
      { connections_broker: replacement },
      {},
    ).rules,
    { model_gateway: model, connections_broker: connection },
  );
  const enabled = composeNetworkRules(
    { model_gateway: model, public_web: publicWebPolicy(true) },
    { connections_broker: replacement },
    {},
  );
  assert.deepEqual(enabled.rules.model_gateway, model);
  assert.deepEqual(
    composeNetworkRules(
      enabled.rules,
      { connections_broker: null },
      enabled.adjustments,
    ).rules,
    { model_gateway: model, public_web: publicWebPolicy(true) },
  );
});

await test("pending policy edits preserve unrelated rules, reconcile lost responses and verify effective activation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-network-"));
  const input = parseLocalInput({
    name: "network-test",
    agentName: "ClawScarf",
    administratorName: "Admin",
    runtimeImage: `sha256:${"a".repeat(64)}`,
    companionImage: `sha256:${"b".repeat(64)}`,
    openshellCli: "/tools/openshell",
    openshellGateway: "/tools/gateway",
    openshellClientImage: `sha256:${"c".repeat(64)}`,
    team: {
      origin: "http://127.0.0.1:18800",
      widgetOrigin: "http://127.0.0.1:18802",
      issuer: "https://id.example",
      clientId: "test",
      clientSecretFile: "/secret",
    },
    ports: {
      controller: 18001,
      application: 18800,
      widgets: 18802,
      management: 18002,
      native: 18003,
      nativeWidgets: 18004,
      database: 18005,
    },
    cpu: "1",
    memory: "512Mi",
  });
  const state: LocalState = {
    schemaVersion: 1,
    ownerId: "c350086f-1e9e-4d47-aad8-474ef1d138aa",
    input,
  };
  try {
    await mkdir(join(directory, "private"));
    await writeFile(
      join(directory, "private/network-policy-adjustments.json"),
      JSON.stringify({ ownerId: state.ownerId, rules: {} }),
    );
    const name = resourceNames(state).sandbox;
    const intent = { ownerId: state.ownerId, name, image: input.runtimeImage };
    await writeFile(
      join(directory, "runtime-create.json"),
      JSON.stringify(intent),
    );
    await writeFile(
      join(directory, "runtime.json"),
      JSON.stringify({ ...intent, id: "c350086f-1e9e-4d47-aad8-474ef1d138ab" }),
    );
    let activeVersion = 1;
    let hasPublicWeb = true;
    let edited = false;
    let writes = 0;
    const command = async (_executable: string, args: readonly string[]) => {
      if (args[0] === "sandbox") {
        const target = {
          id: "c350086f-1e9e-4d47-aad8-474ef1d138ab",
          name,
          phase: "Ready",
          workspace: "default",
          labels: { "clawscarf.installation": state.ownerId },
        };
        return JSON.stringify(args[1] === "list" ? [target] : target);
      }
      if (args[1] === "set") {
        writes++;
        const written: unknown = JSON.parse(
          await readFile(
            join(directory, "private/runtime-policy.json"),
            "utf8",
          ),
        );
        assert.deepEqual(written, {
          network_policies: {
            operator_rule: { name: "Keep me" },
          },
        });
        hasPublicWeb = false;
        throw Error("lost response");
      }
      assert.equal(args[1], "get");
      return JSON.stringify({
        sandbox: name,
        policy_source: "sandbox",
        version: 2,
        active_version: activeVersion,
        status: activeVersion === 2 ? "effective" : "pending",
        policy: {
          network_policies: {
            operator_rule: { name: "Keep me" },
            ...(hasPublicWeb
              ? {
                  public_web: {
                    ...publicWebPolicy(true),
                    ...(edited ? { name: "Operator edit" } : {}),
                  },
                }
              : {}),
          },
        },
      });
    };
    await stageNetworkPolicyChange(
      directory,
      await planNetworkPolicyChange(
        directory,
        state,
        { public_web: null },
        command,
      ),
    );
    await assert.rejects(
      planNetworkPolicyChange(
        directory,
        state,
        { public_web: publicWebPolicy(true) },
        command,
      ),
      /pending network change/,
    );
    edited = true;
    await assert.rejects(
      applyNetworkPolicy(directory, state, {}, false, command),
      /changed after review/,
    );
    assert.equal(writes, 0);
    edited = false;
    await assert.rejects(
      applyNetworkPolicy(directory, state, {}, false, command),
      /lost response/,
    );
    await applyNetworkPolicy(directory, state, {}, false, command);
    assert.equal(writes, 1);
    await assert.rejects(
      applyNetworkPolicy(directory, state, {}, true, command),
      /not become effective/u,
    );
    await readFile(join(directory, "private/network-policy-change.json"));
    activeVersion = 2;
    await applyNetworkPolicy(directory, state, {}, true, command);
    await assert.rejects(
      readFile(join(directory, "private/network-policy-change.json")),
      { code: "ENOENT" },
    );
    await stageNetworkPolicyChange(
      directory,
      await planNetworkPolicyChange(
        directory,
        state,
        { public_web: null },
        command,
      ),
    );
    await assert.rejects(
      planNetworkPolicyChange(
        directory,
        { ...state, ownerId: "wrong-owner" },
        { public_web: null },
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("public-web compatibility rejects private, mixed and unresolved HTTPS services before setup", async () => {
  const { validatePublicWebServices } =
    await import("../../scripts/deployment/service-network.js");
  const services = { models: { host: "models.example", port: 443 } };
  const publicOnly = () => Promise.resolve([{ address: "1.1.1.1", family: 4 }]);
  const privateOnly = () =>
    Promise.resolve([{ address: "10.0.0.1", family: 4 }]);
  await validatePublicWebServices(true, services, publicOnly);
  await assert.rejects(
    validatePublicWebServices(true, services, privateOnly),
    /Turn Public web off/,
  );
  await assert.rejects(
    validatePublicWebServices(true, services, async () => [
      ...(await publicOnly()),
      ...(await privateOnly()),
    ]),
    /private or reserved/,
  );
  await assert.rejects(
    validatePublicWebServices(true, services, () =>
      Promise.reject(Error("private DNS diagnostics")),
    ),
    /could not be resolved/,
  );
  await validatePublicWebServices(false, services, privateOnly);
  await validatePublicWebServices(
    true,
    { models: { ...services.models, port: 4000 } },
    privateOnly,
  );
});
