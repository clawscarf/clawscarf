import assert from "node:assert/strict";
import { test } from "node:test";
import {
  networkRequirementSchema,
  PolicyVerificationError,
  verifyNetworkPolicy,
} from "../../scripts/packs/policy.js";

const requirement = networkRequirementSchema.parse({
  binary: "/usr/local/bin/node",
  host: "api.example.com",
  port: 443,
  protocol: "tcp",
});
const policyHash = "a".repeat(64);
const identity = {
  id: "fixture-sandbox-id",
  name: "fixture",
  phase: "Ready",
  current_policy_version: 7,
};
const loaded = {
  sandbox: "fixture",
  version: 7,
  active_version: 7,
  hash: policyHash,
  status: "loaded",
  loaded_at_ms: 1000,
};
const endpoint = { host: requirement.host, port: 443, protocol: "tcp" };
function effective(
  policy: unknown = {
    network_policies: {
      api: { endpoints: [endpoint], binaries: [{ path: requirement.binary }] },
    },
  },
  fields: Record<string, unknown> = {},
) {
  // OpenShell emits a uint64, often beyond Number.MAX_SAFE_INTEGER.
  return JSON.stringify({
    sandbox: "fixture",
    version: 7,
    hash: policyHash,
    status: "effective",
    policy_source: "sandbox",
    policy,
    ...fields,
  }).replace(/}$/, ',"config_revision":18446744073709551614}');
}
function target(responses: readonly string[]) {
  const calls: (readonly string[])[] = [];
  return {
    sandbox: "fixture",
    sandboxId: identity.id,
    calls,
    run(args: readonly string[]) {
      calls.push(args);
      const response = responses[calls.length - 1];
      assert.ok(response, "Verifier made an unexpected CLI call");
      return Promise.resolve(response);
    },
  };
}
function sequence(value = effective(), revision = loaded) {
  return [
    JSON.stringify(identity),
    value,
    JSON.stringify(revision),
    value,
    JSON.stringify(identity),
  ];
}
const code = (expected: PolicyVerificationError["code"]) => (error: unknown) =>
  error instanceof PolicyVerificationError && error.code === expected;

await test("pack policy requires loaded acknowledgment and preserves uint64 revision exactly", async () => {
  const runtime = target(sequence());
  const proof = await verifyNetworkPolicy([requirement], runtime);
  assert.deepEqual(proof, {
    sandboxId: identity.id,
    version: 7,
    hash: policyHash,
    configRevision: "18446744073709551614",
  });
  assert.deepEqual(runtime.calls[2], [
    "policy",
    "get",
    "fixture",
    "--rev",
    "7",
    "--output",
    "json",
  ]);
  assert.equal(runtime.calls.length, 5);
  assert.ok(runtime.calls.every((call) => call[1] === "get"));
});

await test("effective configuration alone cannot qualify pending, failed or inactive policy", async () => {
  for (const revision of [
    { ...loaded, status: "pending" },
    { ...loaded, status: "failed", load_error: "rejected" },
    { ...loaded, active_version: 6 },
    { ...loaded, loaded_at_ms: 0 },
  ]) {
    await assert.rejects(
      verifyNetworkPolicy(
        [requirement],
        target(sequence(effective(), revision)),
      ),
    );
  }
  await assert.rejects(
    verifyNetworkPolicy(
      [requirement],
      target(sequence(effective(), { ...loaded, hash: "b".repeat(64) })),
    ),
    code("policy_unsupported"),
  );
});

await test("endpoint coverage must include the requested process and port", async () => {
  for (const candidate of [
    { binary: "/usr/bin/python3" },
    { port: 8443 },
    { host: "other.example.com" },
  ]) {
    await assert.rejects(
      verifyNetworkPolicy(
        [{ ...requirement, ...candidate }],
        target(sequence()),
      ),
      code("network_not_permitted"),
    );
  }
});

await test("omitted native protocol is explicit-proxy passthrough, never a TCP default", async () => {
  for (const candidate of [
    { host: requirement.host, port: 443 },
    { host: requirement.host, port: 443, tls: "skip" },
  ]) {
    const value = effective({
      network_policies: {
        api: {
          endpoints: [candidate],
          binaries: [{ path: requirement.binary }],
        },
      },
    });
    await assert.rejects(
      verifyNetworkPolicy([requirement], target(sequence(value))),
      (error: unknown) =>
        error instanceof PolicyVerificationError &&
        error.code === "policy_unsupported" &&
        error.message.includes("explicit-proxy passthrough, not native TCP"),
    );
  }
});

await test("conditional, audited, wildcard and middleware policies fail closed", async () => {
  for (const candidate of [
    { ...endpoint, protocol: "rest" },
    { ...endpoint, enforcement: "audit" },
    { ...endpoint, rules: [{ methods: ["GET"] }] },
    { ...endpoint, allowed_ips: ["192.0.2.1"] },
    { ...endpoint, host: "*.example.com" },
  ]) {
    const value = effective({
      network_policies: {
        api: {
          endpoints: [candidate],
          binaries: [{ path: requirement.binary }],
        },
      },
    });
    await assert.rejects(
      verifyNetworkPolicy([requirement], target(sequence(value))),
      code("policy_unsupported"),
    );
  }
  for (const policy of [
    {
      network_policies: {
        api: { endpoints: [endpoint], binaries: [{ path: "/usr/*/node" }] },
      },
    },
    {
      network_policies: {},
      network_middlewares: { check: { type: "custom" } },
    },
  ]) {
    await assert.rejects(
      verifyNetworkPolicy([requirement], target(sequence(effective(policy)))),
      code("policy_unsupported"),
    );
  }
});

await test("global source and sandbox replacement cannot reuse a policy proof", async () => {
  await assert.rejects(
    verifyNetworkPolicy(
      [requirement],
      target(sequence(effective(undefined, { policy_source: "global" }))),
    ),
    code("policy_unsupported"),
  );
  const initial = sequence();
  initial[0] = JSON.stringify({ ...identity, id: "replacement" });
  await assert.rejects(
    verifyNetworkPolicy([requirement], target(initial)),
    code("policy_changed"),
  );
  const final = sequence();
  final[4] = JSON.stringify({ ...identity, id: "replacement" });
  await assert.rejects(
    verifyNetworkPolicy([requirement], target(final)),
    code("policy_changed"),
  );
});

await test("policy and config changes during inspection invalidate coverage", async () => {
  for (const after of [
    effective(undefined, { hash: "b".repeat(64) }),
    effective().replace("18446744073709551614", "18446744073709551613"),
  ]) {
    const responses = sequence();
    responses[3] = after;
    await assert.rejects(
      verifyNetworkPolicy([requirement], target(responses)),
      code("policy_changed"),
    );
  }
});

await test("no network requirement needs no policy calls; malformed requirements never reach CLI", async () => {
  const runtime = target([]);
  assert.equal(await verifyNetworkPolicy([], runtime), null);
  for (const input of [
    { ...requirement, binary: "/usr/../bin/node" },
    { ...requirement, host: "*.example.com" },
    { ...requirement, host: "192.0.2.1" },
    { ...requirement, binary: "/usr/bin/node\0" },
  ])
    await assert.rejects(verifyNetworkPolicy([input], runtime));
  assert.equal(runtime.calls.length, 0);
});
