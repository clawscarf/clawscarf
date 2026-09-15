import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { run, LocalSetupError } from "./process.js";
import {
  ensurePrivateFile,
  writePrivate,
  resourceNames,
  type LocalState,
} from "./state.js";

const targetSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phase: z.string(),
  workspace: z.literal("default"),
  labels: z.record(z.string(), z.string()),
});
type Target = z.infer<typeof targetSchema>;
const intentSchema = z.strictObject({
  ownerId: z.uuid(),
  name: z.string(),
  image: z.string(),
});
const receiptSchema = intentSchema.extend({ id: z.uuid() });
type Command = typeof run;
async function readOptional(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}
function uncertain(): never {
  throw new LocalSetupError(
    "runtime_outcome_unknown",
    "Runtime creation was attempted but its owned target is absent. Inspect this installation; setup will not create another runtime automatically.",
  );
}
function changed(): never {
  throw new LocalSetupError(
    "runtime_identity_changed",
    "The runtime identity or ownership differs from this installation. No further runtime command was sent.",
  );
}
function targetManager(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  command: Command,
  configuration: RuntimeTarget,
) {
  const name = configuration.name;
  const intent = {
    ownerId: state.ownerId,
    name,
    image: configuration.image,
  };
  const receiptPath = join(directory, configuration.record + ".json");
  const intentPath = join(directory, configuration.record + "-create.json");
  const shell = (args: readonly string[]) =>
    command(
      state.input.openshellCli,
      [
        ...args,
        "--gateway",
        resourceNames(state).sandbox,
        "--workspace",
        "default",
      ],
      { env, timeout: 120000 },
    );
  async function observe(): Promise<Target | undefined> {
    const matching: Target[] = [];
    const seen = new Set<string>();
    const limit = 100;
    for (let offset = 0; ; offset += limit) {
      if (offset > 0xffffffff - limit)
        throw new LocalSetupError(
          "runtime_lookup_incomplete",
          "Runtime lookup did not complete. No absence or creation decision was made.",
        );
      const rows = z
        .array(targetSchema)
        .max(limit)
        .parse(
          JSON.parse(
            await shell([
              "sandbox",
              "list",
              "--limit",
              String(limit),
              "--offset",
              String(offset),
              "-o",
              "json",
            ]),
          ),
        );
      for (const row of rows) {
        if (seen.has(row.id))
          throw new LocalSetupError(
            "runtime_lookup_incomplete",
            "The runtime list changed or repeated while loading. Retry observation before making changes.",
          );
        seen.add(row.id);
        if (row.name === name) matching.push(row);
      }
      if (rows.length < limit) break;
    }
    if (matching.length > 1) changed();
    const row = matching[0];
    if (!row) return undefined;
    if (row.labels["clawscarf.installation"] !== state.ownerId) changed();
    const current = targetSchema.parse(
      JSON.parse(await shell(["sandbox", "get", name, "-o", "json"])),
    );
    if (
      current.name !== name ||
      current.id !== row.id ||
      current.labels["clawscarf.installation"] !== state.ownerId
    )
      changed();
    return current;
  }
  async function recorded() {
    const pending = await readOptional(intentPath);
    if (pending !== undefined) {
      const value = intentSchema.parse(pending);
      if (
        value.ownerId !== intent.ownerId ||
        value.name !== name ||
        value.image !== intent.image
      )
        changed();
    }
    const raw = await readOptional(receiptPath);
    const receipt = raw === undefined ? undefined : receiptSchema.parse(raw);
    if (
      receipt &&
      (receipt.ownerId !== intent.ownerId ||
        receipt.name !== name ||
        receipt.image !== intent.image)
    )
      changed();
    if (receipt && pending === undefined) changed();
    return { pending: pending !== undefined, receipt };
  }
  async function confirm(id: string) {
    const result = await observe();
    if (!result || result.id !== id) changed();
    return result;
  }
  return {
    name,
    intent,
    intentPath,
    receiptPath,
    shell,
    observe,
    recorded,
    confirm,
  };
}

interface RuntimeTarget {
  name: string;
  image: string;
  cpu: string;
  memory: string;
  volume: string;
  record: "runtime" | "execution";
  policy: string;
  argv: readonly string[];
}
function gatewayTarget(state: LocalState): RuntimeTarget {
  const names = resourceNames(state);
  return {
    name: names.sandbox,
    image: state.input.runtimeImage,
    cpu: state.input.cpu,
    memory: state.input.memory,
    volume: names.volume,
    record: "runtime",
    policy: "private/runtime-policy.json",
    argv: ["/app/clawscarf/bin/openclaw", "gateway"],
  };
}
function executionTarget(state: LocalState): RuntimeTarget | undefined {
  const execution = state.input.execution;
  if (!execution) return undefined;
  const names = resourceNames(state);
  return {
    name: names.workerSandbox,
    image: execution.image,
    cpu: execution.cpu,
    memory: execution.memory,
    volume: names.workerVolume,
    record: "execution",
    policy: "private/execution-policy.json",
    argv: [
      "/usr/sbin/sshd",
      "-D",
      "-e",
      "-f",
      "/etc/ssh/clawscarf_sshd_config",
      "-p",
      String(execution.port),
    ],
  };
}
export function runtimeManager(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  command: Command,
) {
  return targetManager(directory, state, env, command, gatewayTarget(state));
}

/** Caller holds the installation lock. A persisted create intent is never blindly replayed. */
async function ensureTarget(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  command: Command,
  configuration: RuntimeTarget,
): Promise<{ id: string; name: string; phase: string }> {
  const control = targetManager(directory, state, env, command, configuration);
  const record = await control.recorded();
  let target = await control.observe();
  if (record.receipt && target?.id !== record.receipt.id) changed();
  if (!target) {
    if (record.pending) uncertain();
    await ensurePrivateFile(
      control.intentPath,
      JSON.stringify(control.intent) + "\n",
    );
    const args = [
      "sandbox",
      "create",
      "--name",
      control.name,
      "--from",
      configuration.image,
      "--policy",
      join(directory, configuration.policy),
      "--cpu",
      configuration.cpu,
      "--memory",
      configuration.memory,
      "--driver-config-json",
      JSON.stringify({
        docker: {
          mounts: [
            {
              type: "volume",
              source: configuration.volume,
              target: "/home/node",
              read_only: false,
            },
          ],
        },
      }),
      "--label",
      `clawscarf.installation=${state.ownerId}`,
      "--no-auto-providers",
      "--detach",
      "--no-tty",
      "--gateway",
      resourceNames(state).sandbox,
      "--workspace",
      "default",
      "--",
      ...configuration.argv,
    ];
    // A failed response may follow successful allocation: reconcile observed identity only.
    try {
      await command(state.input.openshellCli, args, { env, timeout: 180000 });
    } catch {
      target = await control.observe();
      if (!target) uncertain();
    }
    target ??= await control.observe();
    if (!target) uncertain();
  } else if (!record.pending) {
    changed();
  }
  if (!record.receipt)
    await writePrivate(
      control.receiptPath,
      JSON.stringify({ ...control.intent, id: target.id }) + "\n",
    );
  if (target.phase === "Error")
    throw new LocalSetupError(
      "runtime_failed",
      "The owned runtime is in Error. Inspect it before retrying; setup will not replace it.",
    );
  if (target.phase === "Stopped") {
    await control.confirm(target.id);
    await control.shell(["sandbox", "start", target.name]);
    target = await control.confirm(target.id);
    if (target.phase === "Error" || target.phase === "Stopped")
      throw new LocalSetupError(
        "runtime_start_failed",
        "The owned runtime did not confirm startup. Inspect it before retrying.",
      );
  }
  return { id: target.id, name: target.name, phase: target.phase };
}

/** Native start/stop resolve names; identity checks detect replacement, not an atomic UUID precondition. */
async function stopTarget(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  command: Command,
  configuration: RuntimeTarget,
): Promise<void> {
  const control = targetManager(directory, state, env, command, configuration);
  const record = await control.recorded();
  const target = await control.observe();
  if (!target) {
    if (record.pending || record.receipt) uncertain();
    return;
  }
  if (!record.receipt || record.receipt.id !== target.id) changed();
  if (target.phase === "Stopped") return;
  if (target.phase === "Error")
    throw new LocalSetupError(
      "runtime_failed",
      "The owned runtime is in Error. Inspect it before continuing.",
    );
  await control.confirm(target.id);
  await control.shell(["sandbox", "stop", target.name]);
  const stopped = await control.confirm(target.id);
  if (stopped.phase !== "Stopped")
    throw new LocalSetupError(
      "runtime_stop_pending",
      "The runtime has not confirmed Stopped. Keep its controller running and inspect its state.",
    );
}

export async function ensureRuntime(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  command: Command = run,
) {
  return ensureTarget(directory, state, env, command, gatewayTarget(state));
}
export async function stopRuntime(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  command: Command = run,
) {
  return stopTarget(directory, state, env, command, gatewayTarget(state));
}
export async function ensureExecutionRuntime(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  command: Command = run,
) {
  const configuration = executionTarget(state);
  if (!configuration) return undefined;
  return ensureTarget(directory, state, env, command, configuration);
}
export async function stopExecutionRuntime(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  command: Command = run,
): Promise<void> {
  const configuration = executionTarget(state);
  if (configuration)
    await stopTarget(directory, state, env, command, configuration);
}
