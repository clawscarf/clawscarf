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
export function runtimeManager(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  command: Command,
) {
  const name = resourceNames(state).sandbox;
  const intent = {
    ownerId: state.ownerId,
    name,
    image: state.input.runtimeImage,
  };
  const receiptPath = join(directory, "runtime.json");
  const intentPath = join(directory, "runtime-create.json");
  const shell = (args: readonly string[]) =>
    command(
      state.input.openshellCli,
      [...args, "--gateway", name, "--workspace", "default"],
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

/** Caller holds the installation lock. A persisted create intent is never blindly replayed. */
export async function ensureRuntime(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  command: Command = run,
): Promise<{ id: string; name: string; phase: string }> {
  const control = runtimeManager(directory, state, env, command);
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
      state.input.runtimeImage,
      "--policy",
      join(directory, "private/runtime-policy.json"),
      "--cpu",
      state.input.cpu,
      "--memory",
      state.input.memory,
      "--driver-config-json",
      JSON.stringify({
        docker: {
          mounts: [
            {
              type: "volume",
              source: resourceNames(state).volume,
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
      control.name,
      "--workspace",
      "default",
      "--",
      "/app/clawscarf/bin/openclaw",
      "gateway",
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
export async function stopRuntime(
  directory: string,
  state: LocalState,
  env: NodeJS.ProcessEnv,
  command: Command = run,
): Promise<void> {
  const control = runtimeManager(directory, state, env, command);
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
