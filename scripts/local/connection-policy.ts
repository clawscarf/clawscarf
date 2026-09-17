import { isDeepStrictEqual } from "node:util";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { run } from "./process.js";
import { resourceNames, writePrivate, type LocalState } from "./state.js";
import { runtimeManager } from "./runtime.js";

const ruleSchema = z.object({
  name: z.string(),
  endpoints: z.array(
    z.object({ host: z.string(), port: z.number(), tls: z.string() }),
  ),
  binaries: z.array(z.object({ path: z.string() })),
});
const policySchema = z.looseObject({
  network_policies: z.record(z.string(), z.unknown()),
});
/** Apply only the explicitly selected broker rule; never regenerate an operator's other policies. */
export async function applyConnectionPolicy(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  verify = false,
) {
  const pending = join(directory, "private/connection-policy-change.json");
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
      rule: ruleSchema.nullable(),
    })
    .parse(JSON.parse(text));
  const base = join(directory, "private/runtime-policy.json");
  const update = (policy: z.infer<typeof policySchema>) => {
    if (change.rule) policy.network_policies.connections_broker = change.rule;
    else delete policy.network_policies.connections_broker;
    return policy;
  };
  const matches = (rule: unknown) => {
    if (change.rule === null) return rule === undefined;
    const parsed = ruleSchema.safeParse(rule);
    return parsed.success && isDeepStrictEqual(parsed.data, change.rule);
  };
  const name = resourceNames(state).sandbox;
  if (!(await runtimeManager(directory, state, env, run).recorded()).receipt) {
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
      policy: policySchema,
    })
    .parse(
      JSON.parse(
        await run(
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
  if (matches(observed.policy.network_policies.connections_broker)) {
    if (verify) await rm(pending);
    return;
  }
  if (verify)
    throw Error(
      "The Connections network permission was not confirmed. The installation remains unavailable.",
    );
  await writePrivate(base, JSON.stringify(update(observed.policy)));
  await run(
    state.input.openshellCli,
    ["policy", "set", name, "--gateway", name, "--policy", base],
    { env },
  );
}
