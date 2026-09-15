import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { OpenClawAuthority } from "../../services/access/providers/native.js";
import { NativeFailure } from "../../services/access/types/native-errors.js";
import {
  pendingRole,
  pendingPolicy,
} from "../../services/access/providers/native-state.js";
import type {
  withGateway,
  NativeGateway,
} from "../../services/access/providers/gateway.js";

function fixture(
  failure: "access_denied" | "invalid_response" = "access_denied",
  displayName = "",
) {
  const identity = "clawscarf:actor",
    other = "clawscarf:other";
  let revoked = false,
    writes = 0;
  const pendingScopes: string[] = [];
  const config = {
    gateway: {
      roles: {
        default: pendingRole,
        definitions: {
          [pendingRole]: { ...pendingPolicy, scopes: pendingScopes },
          member: {
            agents: "*",
            scopes: ["operator.read"],
            sessions: { others: "none" },
          },
          admin: {
            agents: "*",
            scopes: ["operator.admin"],
            sessions: { others: "write" },
          },
        },
      },
      auth: {
        mode: "trusted-proxy",
        identityScopes: {
          [identity]: ["operator.admin"],
          [other]: ["operator.admin"],
        },
        trustedProxy: { allowUsers: [identity, other] },
      },
    },
  };
  const profiles = [identity, other].map((email, index) => ({
    id: `profile-${index}`,
    emails: [email],
    role: "admin",
    updatedAt: 1,
    displayName,
  }));
  const gateway: NativeGateway = {
    scopes: ["operator.admin"],
    read(method) {
      if (method === "users.self")
        return Promise.resolve({ profile: profiles[0] });
      if (method === "users.list") return Promise.resolve({ profiles });
      if (method === "config.get")
        return Promise.resolve({
          valid: true,
          hash: "revision",
          sourceConfig: config,
        });
      return Promise.resolve({});
    },
    mutate(method, input) {
      if (method === "users.setDisplayName") {
        const data = z
          .object({ profileId: z.string(), displayName: z.string() })
          .parse(input);
        const profile = profiles.find((item) => item.id === data.profileId);
        assert.ok(profile);
        profile.displayName = data.displayName;
        writes++;
        return Promise.resolve({ profile });
      }
      assert.equal(method, "config.patch");
      const request = z
        .object({ raw: z.string(), replacePaths: z.array(z.string()) })
        .parse(input);
      const patch: unknown = JSON.parse(request.raw);
      const auth = z
        .object({
          gateway: z.object({
            auth: z.object({
              trustedProxy: z.object({ allowUsers: z.array(z.string()) }),
              identityScopes: z.record(z.string(), z.array(z.string())),
            }),
          }),
        })
        .parse(patch).gateway.auth;
      assert.equal(auth.trustedProxy.allowUsers.length, 1);
      assert.ok(
        request.replacePaths.includes("gateway.auth.trustedProxy.allowUsers"),
      );
      for (const [identity, scopes] of Object.entries(auth.identityScopes)) {
        assert.deepEqual(scopes, []);
        assert.ok(
          request.replacePaths.includes(
            `gateway.auth.identityScopes.${identity}`,
          ),
        );
      }
      writes++;
      revoked = true;
      return Promise.resolve({ ok: true });
    },
  };
  const connect: typeof withGateway = async (_options, work) => {
    if (revoked) throw new NativeFailure(failure);
    return work(gateway);
  };
  return {
    config,
    authority: new OpenClawAuthority("https://team.example", { connect }),
    identity,
    other,
    writes: () => writes,
    displayName: () => profiles[0]?.displayName,
  };
}
await test("self-revocation succeeds after definitive denial, without replaying the write", async () => {
  const f = fixture();
  await f.authority.revoke(
    { identity: f.identity, sessionHash: "hash" },
    "credential",
    f.identity,
    [f.identity, f.other],
  );
  assert.equal(f.writes(), 1);
});
await test("explicit team preparation enriches an empty native administrator name", async () => {
  const f = fixture();
  await f.authority.prepareTeam(
    { identity: f.identity, sessionHash: "hash", name: "Ada" },
    "credential",
  );
  assert.equal(f.displayName(), "Ada");
  assert.equal(f.writes(), 1);
});
await test("team preparation preserves a native administrator's edited display name", async () => {
  const f = fixture("access_denied", "My chosen name");
  await f.authority.prepareTeam(
    { identity: f.identity, sessionHash: "hash", name: "Ada" },
    "credential",
  );
  assert.equal(f.displayName(), "My chosen name");
  assert.equal(f.writes(), 0);
});
await test("self-revocation never treats malformed response as proof of denied access", async () => {
  const f = fixture("invalid_response");
  await assert.rejects(
    f.authority.revoke(
      { identity: f.identity, sessionHash: "hash" },
      "credential",
      f.identity,
      [f.identity, f.other],
    ),
    (error: unknown) =>
      error instanceof NativeFailure && error.code === "invalid_response",
  );
  assert.equal(f.writes(), 1);
});
await test("retained native profiles do not bypass last currently admitted administrator guard", async () => {
  const f = fixture();
  await assert.rejects(
    f.authority.revoke(
      { identity: f.identity, sessionHash: "hash" },
      "credential",
      f.identity,
      [f.identity],
    ),
    (error: unknown) =>
      error instanceof NativeFailure && error.code === "last_administrator",
  );
  assert.equal(f.writes(), 0);
});
await test("denial of acting admin does not confirm revocation of a different person", async () => {
  const f = fixture();
  await assert.rejects(
    f.authority.revoke(
      { identity: f.identity, sessionHash: "hash" },
      "credential",
      f.other,
      [f.identity, f.other],
    ),
    (error: unknown) =>
      error instanceof NativeFailure && error.code === "access_denied",
  );
  assert.equal(f.writes(), 1);
});

await test("team readiness observes preparation and conflicting native edits without mutation", async () => {
  const f = fixture();
  const actor = { identity: f.identity, sessionHash: "hash" };
  assert.equal(await f.authority.observeTeam(actor, "credential"), "ready");
  f.config.gateway.roles.default = "admin";
  assert.equal(
    await f.authority.observeTeam(actor, "credential"),
    "preparation_required",
  );
  f.config.gateway.roles.definitions.member.scopes = ["operator.admin"];
  assert.equal(
    await f.authority.observeTeam(actor, "credential"),
    "configuration_required",
  );
  f.config.gateway.roles.definitions.member.scopes = ["operator.read"];
  f.config.gateway.roles.definitions[pendingRole] = {
    ...pendingPolicy,
    scopes: ["operator.read"],
  };
  assert.equal(
    await f.authority.observeTeam(actor, "credential"),
    "configuration_required",
  );
  assert.equal(f.writes(), 0);
});
await test("team observation requires native administrator authority", async () => {
  let configReads = 0;
  const connect: typeof withGateway = (_options, work) =>
    work({
      scopes: ["operator.read"],
      read: (method) => {
        if (method === "users.self")
          return Promise.resolve({
            profile: {
              id: "member",
              emails: ["clawscarf:member"],
              updatedAt: 1,
            },
          });
        if (method === "exec.approvals.get")
          throw new NativeFailure("access_denied");
        configReads++;
        return Promise.resolve({});
      },
      mutate: () => {
        throw Error("Observation must never write");
      },
    });
  const authority = new OpenClawAuthority("https://team.example", { connect });
  await assert.rejects(
    authority.observeTeam(
      { identity: "clawscarf:member", sessionHash: "hash" },
      "credential",
    ),
    { code: "access_denied" },
  );
  assert.equal(configReads, 0);
});
