import { isDeepStrictEqual } from "node:util";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { run, LocalSetupError } from "./process.js";
import { resourceNames, writePrivate, type LocalState } from "./state.js";
import {
  composeNetworkRules,
  adjustmentsSchema,
  networkChangesSchema,
  type NetworkChanges,
} from "./public-web.js";
import { runtimeEnvironment, runtimeManager } from "./runtime.js";

const policySchema = z.looseObject({
  network_policies: z.record(z.string(), z.unknown()),
});
const pendingSchema = z.strictObject({
  ownerId: z.uuid(),
  requested: networkChangesSchema,
  changes: z.record(
    z.string(),
    z.strictObject({ before: z.unknown(), after: z.unknown() }),
  ),
  adjustments: adjustmentsSchema,
});
async function optionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}
async function observe(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  command: typeof run,
) {
  const name = resourceNames(state).sandbox;
  const control = runtimeManager(directory, state, env, command);
  const { receipt } = await control.recorded();
  if (!receipt)
    return {
      policy: policySchema.parse(
        JSON.parse(
          await readFile(
            join(directory, "private/runtime-policy.json"),
            "utf8",
          ),
        ),
      ),
      effective: false,
      recorded: false,
    };
  await control.confirm(receipt.id);
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
  return {
    policy: observed.policy,
    effective:
      observed.active_version === observed.version &&
      observed.status === "effective",
    recorded: true,
  };
}

/** Validate the whole selected change before service mutation. Caller holds the installation lock and starts its controller. */
export async function planNetworkPolicyChange(
  directory: string,
  state: LocalState,
  requested: NetworkChanges,
  command: typeof run = run,
) {
  const file = join(directory, "private/network-policy-change.json");
  const saved = await optionalJson(file);
  if (saved !== undefined) {
    const pending = pendingSchema
      .extend({ ownerId: z.literal(state.ownerId) })
      .parse(saved);
    if (!isDeepStrictEqual(pending.requested, requested))
      throw new LocalSetupError(
        "configuration_changed",
        "Resume the pending network change before selecting another policy.",
      );
    return pending;
  }
  const { policy } = await observe(
    directory,
    state,
    runtimeEnvironment(directory),
    command,
  );
  const owned = z
    .strictObject({
      ownerId: z.literal(state.ownerId),
      rules: adjustmentsSchema,
    })
    .parse(
      JSON.parse(
        await readFile(
          join(directory, "private/network-policy-adjustments.json"),
          "utf8",
        ),
      ),
    );
  const composed = composeNetworkRules(
    policy.network_policies,
    requested,
    owned.rules,
  );
  const keys = new Set([
    ...Object.keys(policy.network_policies),
    ...Object.keys(composed.rules),
  ]);
  const changes = Object.fromEntries(
    [...keys]
      .filter(
        (key) =>
          !isDeepStrictEqual(policy.network_policies[key], composed.rules[key]),
      )
      .map((key) => [
        key,
        {
          before: policy.network_policies[key] ?? null,
          after: composed.rules[key] ?? null,
        },
      ]),
  );
  return {
    ownerId: state.ownerId,
    requested,
    changes,
    adjustments: composed.adjustments,
  };
}

export async function stageNetworkPolicyChange(
  directory: string,
  change: Awaited<ReturnType<typeof planNetworkPolicyChange>>,
) {
  await writePrivate(
    join(directory, "private/network-policy-change.json"),
    JSON.stringify(change),
  );
}

/** Compare selected rules with their reviewed values; preserve unrelated edits and reconcile uncertain policy-set outcomes. */
export async function applyNetworkPolicy(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  verify = false,
  command: typeof run = run,
) {
  const file = join(directory, "private/network-policy-change.json");
  const saved = await optionalJson(file);
  if (saved === undefined) return;
  const pending = pendingSchema
    .extend({ ownerId: z.literal(state.ownerId) })
    .parse(saved);
  const observed = await observe(directory, state, env, command);
  const rules = { ...observed.policy.network_policies };
  let changed = false;
  for (const [key, { before, after }] of Object.entries(pending.changes)) {
    const actual = rules[key] ?? null;
    if (isDeepStrictEqual(actual, after)) continue;
    if (!isDeepStrictEqual(actual, before))
      throw new LocalSetupError(
        "configuration_changed",
        "A selected network rule changed after review. No policy was overwritten; inspect the pending change.",
      );
    changed = true;
    if (after === null) Reflect.deleteProperty(rules, key);
    else rules[key] = after;
  }
  if (verify) {
    if (changed || !observed.effective)
      throw new LocalSetupError(
        "invalid_runtime_policy",
        "The selected network policy has not become effective in the runtime.",
      );
    await writePrivate(
      join(directory, "private/network-policy-adjustments.json"),
      JSON.stringify({ ownerId: state.ownerId, rules: pending.adjustments }),
    );
    await rm(file);
    return;
  }
  if (!changed) return;
  const base = join(directory, "private/runtime-policy.json");
  await writePrivate(
    base,
    JSON.stringify({ ...observed.policy, network_policies: rules }),
  );
  if (observed.recorded) {
    const name = resourceNames(state).sandbox;
    await command(
      state.input.openshellCli,
      ["policy", "set", name, "--gateway", name, "--policy", base],
      { env },
    );
  }
}
