import { isDeepStrictEqual } from "node:util";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { run } from "./process.js";
import { resourceNames, writePrivate, type LocalState } from "./state.js";
import { composePublicWebRules } from "./public-web.js";
import { runtimeManager } from "./runtime.js";

const connectionRuleSchema = z.object({
  name: z.string(),
  endpoints: z.array(
    z.object({
      host: z.string(),
      port: z.number(),
      tls: z.string(),
      allowed_ips: z.array(z.string()).optional(),
    }),
  ),
  binaries: z.array(z.object({ path: z.string() })),
});
const publicRuleSchema = z.object({
  name: z.string(),
  endpoints: z.array(
    z.object({
      ports: z.array(z.number()),
      allowed_ips: z.array(z.string()),
      tls: z.string(),
    }),
  ),
  binaries: z.array(z.object({ path: z.string() })),
});
const changesSchema = z.strictObject({
  connections_broker: connectionRuleSchema.nullable().optional(),
  public_web: publicRuleSchema.nullable().optional(),
});
export async function stageNetworkPolicyChange(
  directory: string,
  state: LocalState,
  rules: z.infer<typeof changesSchema>,
) {
  const file = join(directory, "private/network-policy-change.json");
  let previous: z.infer<typeof changesSchema> = {};
  try {
    previous = z
      .strictObject({ ownerId: z.literal(state.ownerId), rules: changesSchema })
      .parse(JSON.parse(await readFile(file, "utf8"))).rules;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  await writePrivate(
    file,
    JSON.stringify({
      ownerId: state.ownerId,
      rules: changesSchema.parse({ ...previous, ...rules }),
    }),
  );
}
const policySchema = z.looseObject({
  network_policies: z.record(z.string(), z.unknown()),
});
/** Apply only explicitly selected managed rules; never regenerate an operator's other policies. */
export async function applyNetworkPolicy(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  verify = false,
  command: typeof run = run,
) {
  const pending = join(directory, "private/network-policy-change.json");
  let text: string;
  try {
    text = await readFile(pending, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
  const change = z
    .strictObject({
      ownerId: z.literal(state.ownerId),
      rules: changesSchema,
    })
    .parse(JSON.parse(text));
  const base = join(directory, "private/runtime-policy.json");
  const update = (policy: z.infer<typeof policySchema>) => {
    return {
      ...policy,
      network_policies: composePublicWebRules(
        Object.fromEntries([
          ...Object.entries(policy.network_policies).filter(
            ([key]) => !Object.hasOwn(change.rules, key),
          ),
          ...Object.entries(change.rules).filter(([, rule]) => rule !== null),
        ]),
      ),
    };
  };
  const matches = (policy: z.infer<typeof policySchema>) => {
    const expected = update(policy).network_policies;
    return [
      ...new Set([
        ...Object.keys(change.rules),
        "connections_broker",
        "model_gateway",
      ]),
    ].every((key) => {
      const observed = policy.network_policies[key];
      if (!Object.hasOwn(change.rules, key))
        return isDeepStrictEqual(observed, expected[key]);
      if (expected[key] === undefined) return observed === undefined;
      const schema =
        key === "public_web" ? publicRuleSchema : connectionRuleSchema;
      const actualRule = schema.safeParse(observed);
      const expectedRule = schema.safeParse(expected[key]);
      return (
        actualRule.success &&
        expectedRule.success &&
        isDeepStrictEqual(actualRule.data, expectedRule.data)
      );
    });
  };
  const name = resourceNames(state).sandbox;
  if (
    !(await runtimeManager(directory, state, env, command).recorded()).receipt
  ) {
    if (verify) throw Error("The configured runtime has not been recorded.");
    await writePrivate(
      base,
      JSON.stringify(
        update(policySchema.parse(JSON.parse(await readFile(base, "utf8")))),
      ),
    );
    return;
  }
  const observed = z
    .object({
      sandbox: z.literal(name),
      policy_source: z.literal("sandbox"),
      version: z.number().int(),
      active_version: z.number().int(),
      status: z.string(),
      policy: policySchema,
    })
    .parse(
      JSON.parse(
        await command(
          state.input.openshellCli,
          [
            "policy",
            "get",
            name,
            "--gateway",
            name,
            "--base",
            "--output",
            "json",
          ],
          { env },
        ),
      ),
    );
  if (matches(observed.policy)) {
    if (verify) {
      if (
        observed.active_version !== observed.version ||
        observed.status !== "effective"
      )
        throw Error(
          "The selected network policy has not become effective in the runtime.",
        );
      await rm(pending);
    }
    return;
  }
  if (verify)
    throw Error(
      "The selected network policy was not confirmed. The installation remains unavailable.",
    );
  await writePrivate(base, JSON.stringify(update(observed.policy)));
  await command(
    state.input.openshellCli,
    ["policy", "set", name, "--gateway", name, "--policy", base],
    { env },
  );
}
