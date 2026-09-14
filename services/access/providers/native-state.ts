import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { NativeFailure } from "../types/native-errors.js";
import type { NativeGateway } from "./gateway.js";

const profileSchema = z.object({
  id: z.string().min(1),
  emails: z.array(z.string()),
  displayName: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  mergedInto: z.string().nullable().optional(),
  updatedAt: z.unknown(),
});
const roleSchema = z.looseObject({
  agents: z.union([z.literal("*"), z.array(z.string())]),
  scopes: z.array(z.string()),
  sessions: z.looseObject({
    others: z.enum(["none", "view", "suggest", "write"]),
  }),
  sandbox: z.enum(["inherit", "required"]).optional(),
});
const configSchema = z.object({
  gateway: z.object({
    roles: z.object({
      default: z.string(),
      definitions: z.record(z.string(), roleSchema),
    }),
    auth: z.object({
      mode: z.literal("trusted-proxy"),
      identityScopes: z.record(z.string(), z.array(z.string())),
      trustedProxy: z.object({ allowUsers: z.array(z.string()) }),
    }),
  }),
});

export const pendingRole = "clawscarf_pending";
export const pendingPolicy = {
  sessions: { others: "none" },
  agents: [],
  scopes: [],
  sandbox: "required",
};
export const identityScopes = [
  "operator.read",
  "operator.write",
  "operator.admin",
  "operator.approvals",
  "operator.pairing",
  "operator.questions",
  "operator.talk",
  "operator.talk.secrets",
];
export type NativeProfile = z.infer<typeof profileSchema>;
export function parseNative<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new NativeFailure("invalid_response");
  return result.data;
}
export async function self(gateway: NativeGateway, identity: string) {
  const value = parseNative(
    z.object({ profile: profileSchema }),
    await gateway.read("users.self", {}),
  );
  const profile = profileFor([value.profile], identity);
  if (!profile) throw new NativeFailure("access_denied");
  return profile;
}
export function profileFor(
  profiles: readonly NativeProfile[],
  identity: string,
) {
  const matching = profiles.filter((profile) =>
    profile.emails.includes(identity),
  );
  if (matching.length > 1) throw new NativeFailure("invalid_response");
  const profile = matching[0];
  if (
    profile &&
    (profile.mergedInto ||
      profile.id === "gateway-owner" ||
      profile.emails.filter((email) => email.startsWith("clawscarf:"))
        .length !== 1)
  )
    throw new NativeFailure("access_denied");
  return profile;
}
export async function readState(gateway: NativeGateway) {
  const schema = z.object({
    valid: z.literal(true),
    hash: z.string().min(1),
    sourceConfig: configSchema,
  });
  const before = parseNative(schema, await gateway.read("config.get", {}));
  const { profiles } = parseNative(
    z.object({ profiles: z.array(profileSchema) }),
    await gateway.read("users.list", {}),
  );
  const after = parseNative(schema, await gateway.read("config.get", {}));
  if (before.hash !== after.hash) throw new NativeFailure("revision_conflict");
  return { config: before.sourceConfig, revision: before.hash, profiles };
}
export type NativeState = Awaited<ReturnType<typeof readState>>;
export function requireTeam(state: NativeState) {
  const roles = state.config.gateway.roles;
  if (
    roles.default !== pendingRole ||
    !isDeepStrictEqual(roles.definitions[pendingRole], pendingPolicy)
  )
    throw new NativeFailure("setup_required");
}
export async function patch(
  gateway: NativeGateway,
  revision: string,
  value: unknown,
  replacePaths: string[] = [],
) {
  const result = await gateway.mutate("config.patch", {
    baseHash: revision,
    raw: JSON.stringify(value),
    replacePaths,
  });
  if (!z.object({ ok: z.literal(true) }).safeParse(result).success)
    throw new NativeFailure("outcome_unknown");
}
