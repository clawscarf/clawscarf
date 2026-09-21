import assert from "node:assert/strict";
import { BlockList, isIP } from "node:net";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialRuntimePolicy } from "../../scripts/deployment/policy.js";
import {
  composePublicWebRules,
  publicWebAddresses,
  publicWebPolicy,
} from "../../scripts/deployment/public-web.js";
import {
  stageNetworkPolicyChange,
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

await test("public web composes with HTTPS services and restores strict service rules", () => {
  const connections = {
    brokerUrl: "https://cloud.clawscarf.com",
    network: {
      host: "cloud.clawscarf.com",
      port: 443,
      protocol: "tcp" as const,
      binary: "/usr/local/bin/node",
    },
  };
  const strict = initialRuntimePolicy(
    "network_policies: {}",
    undefined,
    connections,
  ).network_policies;
  const combined = initialRuntimePolicy(
    "network_policies: {}",
    undefined,
    connections,
    true,
  ).network_policies;
  assert.deepEqual(
    combined.connections_broker?.endpoints[0]?.allowed_ips,
    publicWebAddresses,
  );
  assert.deepEqual(
    composePublicWebRules({ ...strict, public_web: publicWebPolicy(true) }),
    combined,
  );
  const { public_web: publicRule, ...services } = combined;
  assert.deepEqual(publicRule, publicWebPolicy(true));
  assert.deepEqual(composePublicWebRules(services), strict);
  const model = {
    name: "Model gateway",
    endpoints: [{ host: "models.example", port: 443, tls: "skip" }],
    binaries: [{ path: "/usr/local/bin/node" }],
  };
  const privateModel = {
    ...model,
    endpoints: [{ host: "models.internal", port: 4000, tls: "skip" }],
  };
  const operator = {
    name: "Operator policy",
    endpoints: [{ host: "private.internal", port: 8443 }],
  };
  const rules = composePublicWebRules({
    ...combined,
    model_gateway: model,
    operator,
  });
  assert.deepEqual(rules.model_gateway, {
    ...model,
    endpoints: [{ ...model.endpoints[0], allowed_ips: publicWebAddresses }],
  });
  assert.deepEqual(rules.operator, operator);
  assert.deepEqual(
    composePublicWebRules({ ...combined, model_gateway: privateModel })
      .model_gateway,
    privateModel,
  );
  assert.throws(
    () =>
      composePublicWebRules({
        ...combined,
        model_gateway: {
          ...model,
          endpoints: [{ ...model.endpoints[0], allowed_ips: ["1.1.1.1/32"] }],
        },
      }),
    /custom IP restrictions/u,
  );
});

await test("pending network edits retain independently selected changes and bind ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-network-"));
  const input = parseLocalInput({
    name: "network-test",
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
    await stageNetworkPolicyChange(directory, state, {
      connections_broker: null,
    });
    await stageNetworkPolicyChange(directory, state, {
      public_web: publicWebPolicy(true),
    });
    await stageNetworkPolicyChange(directory, state, { public_web: null });
    const pending: unknown = JSON.parse(
      await readFile(
        join(directory, "private/network-policy-change.json"),
        "utf8",
      ),
    );
    assert.deepEqual(pending, {
      ownerId: state.ownerId,
      rules: { connections_broker: null, public_web: null },
    });
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
    let writes = 0;
    const command = async (_executable: string, args: readonly string[]) => {
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
        return "";
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
            ...(hasPublicWeb ? { public_web: publicWebPolicy(true) } : {}),
          },
        },
      });
    };
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
    await stageNetworkPolicyChange(directory, state, { public_web: null });
    await assert.rejects(
      stageNetworkPolicyChange(
        directory,
        { ...state, ownerId: "wrong-owner" },
        { public_web: null },
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
