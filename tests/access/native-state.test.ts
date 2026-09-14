import assert from "node:assert/strict";
import { test } from "node:test";
import {
  profileFor,
  readState,
  pendingRole,
  pendingPolicy,
  requireTeam,
  patch,
  type NativeState,
} from "../../services/access/providers/native-state.js";
import type { NativeGateway } from "../../services/access/providers/gateway.js";
import { NativeFailure } from "../../services/access/types/native-errors.js";

const identity = "clawscarf:person";
const profile = { id: "person-profile", emails: [identity], updatedAt: 1 };
await test("native profile matching rejects merged/owner/ambiguous identities", () => {
  assert.equal(profileFor([profile], identity), profile);
  assert.equal(profileFor([profile], "clawscarf:missing"), undefined);
  for (const profiles of [
    [{ ...profile, id: "gateway-owner" }],
    [{ ...profile, mergedInto: "other" }],
    [{ ...profile, emails: [identity, "clawscarf:other"] }],
    [profile, { ...profile, id: "other" }],
  ]) {
    assert.throws(() => profileFor(profiles, identity), NativeFailure);
  }
});
await test("native config observation rejects revision drift and pending policy drift", async () => {
  const config: NativeState["config"] = {
    gateway: {
      roles: {
        default: pendingRole,
        definitions: {
          [pendingRole]: {
            ...pendingPolicy,
            sandbox: "required",
            sessions: { others: "none" },
          },
        },
      },
      auth: {
        mode: "trusted-proxy",
        identityScopes: {},
        trustedProxy: { allowUsers: [identity] },
      },
    },
  };
  let reads = 0;
  const gateway: NativeGateway = {
    scopes: [],
    read(method) {
      return Promise.resolve(
        method === "users.list"
          ? { profiles: [profile] }
          : { valid: true, hash: String(++reads), sourceConfig: config },
      );
    },
    mutate: () => Promise.resolve({ ok: true }),
  };
  await assert.rejects(
    readState(gateway),
    (error: unknown) =>
      error instanceof NativeFailure && error.code === "revision_conflict",
  );
  const state = { revision: "1", profiles: [profile], config };
  requireTeam(state);
  config.gateway.roles.definitions[pendingRole] = {
    ...pendingPolicy,
    sandbox: "required",
    scopes: ["operator.admin"],
    sessions: { others: "none" },
  };
  assert.throws(() => requireTeam(state), NativeFailure);
});
await test("native patch preserves compare-and-swap and replacement paths without replay", async () => {
  const calls: unknown[] = [];
  const gateway: NativeGateway = {
    scopes: [],
    read: () => Promise.resolve({}),
    mutate: (method, input) => {
      calls.push({ method, input });
      return Promise.resolve({ ok: false });
    },
  };
  await assert.rejects(
    patch(
      gateway,
      "revision",
      { gateway: { auth: { identityScopes: { [identity]: [] } } } },
      [`gateway.auth.identityScopes.${identity}`],
    ),
    (error: unknown) =>
      error instanceof NativeFailure && error.code === "outcome_unknown",
  );
  assert.equal(calls.length, 1);
});
