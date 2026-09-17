import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { openPack } from "../packs/source.js";
import { planPack, applyPack } from "../packs/lifecycle.js";
import { planSchema } from "../packs/model.js";
import type { NativeClaws } from "../packs/native.js";
import { OpenShellClaws } from "../packs/openshell.js";
import { readState, resourceNames, writePrivate } from "../local/state.js";
import { fingerprint, readJson } from "./files.js";

export const selectionSchema = z.strictObject({
  python: z.string().optional(),
  packs: z.array(
    z.strictObject({
      directory: z.string(),
      digest: z.string(),
      members: z.array(z.string()),
      bindingsFile: z.string().optional(),
      bindingsDigest: z.string().optional(),
    }),
  ),
});
export const packOutcomeSchema = z.strictObject({
  member: z.string(),
  state: z.enum(["complete", "blocked", "unconfirmed"]),
});
export type PackOutcome = z.infer<typeof packOutcomeSchema>;
export type PackSelection = z.infer<typeof selectionSchema>;
/** Called within the installation's existing lifecycle lock, before readiness is announced. */
export async function activatePacks(
  directory: string,
  report: (message: string) => void,
  target?: NativeClaws,
) {
  const selection = selectionSchema.parse(
    await readJson(join(directory, "packs.json")),
  );
  const receipts = join(directory, "pack-operations");
  await mkdir(receipts, { recursive: true, mode: 0o700 });
  const files = (await readdir(receipts)).filter(
    (file) => file.endsWith(".json") && !file.endsWith("-plan.json"),
  );
  if (!selection.packs.length && !files.length) return [];
  if (!selection.python)
    throw Error("Pack operator is required while removing retained packs.");
  const state = await readState(directory);
  const controller = join(directory, "controller");
  const gateway = resourceNames(state).sandbox;
  const native =
    target ??
    new OpenShellClaws({
      executable: state.input.openshellCli,
      python: selection.python,
      sandbox: gateway,
      workerSandbox: resourceNames(state).workerSandbox,
      gateway,
      env: {
        ...process.env,
        OPENCLAW_EXPERIMENTAL_CLAWS: "1",
        XDG_CONFIG_HOME: join(controller, "config"),
        XDG_STATE_HOME: join(controller, "state"),
        XDG_DATA_HOME: join(controller, "data"),
      },
    });
  const operations = selection.packs.flatMap((pack) =>
    pack.members.map((member) => ({ pack, member, remove: false })),
  );
  const selected = new Set(operations.map((item) => item.member));
  for (const file of files) {
    const member = file.slice(0, -5);
    if (selected.has(member)) continue;
    const previous = planSchema.parse(
      await readJson(join(receipts, member + "-plan.json")),
    );
    if (previous.member !== member)
      throw Error("Pack receipt identity changed.");
    operations.push({
      member,
      remove: true,
      pack: {
        directory: previous.pack,
        digest: previous.packDigest,
        members: [member],
      },
    });
  }
  const outcomes: PackOutcome[] = [];
  for (const { pack, member, remove } of operations) {
    let operation: "add" | "update" | "remove" = remove ? "remove" : "add";
    let attempted = false;
    try {
      const path = join(receipts, member + ".json");
      const selectionDigest = fingerprint(
        JSON.stringify({
          digest: pack.digest,
          bindingsDigest: pack.bindingsDigest,
          member,
        }),
      );
      try {
        const retained = z
          .strictObject({
            ownerId: z.literal(state.ownerId),
            selectionDigest: z.string(),
            state: z.enum(["pending", "complete"]),
          })
          .parse(await readJson(path));
        if (
          retained.state === "complete" &&
          !remove &&
          retained.selectionDigest === selectionDigest
        ) {
          outcomes.push({ member, state: "complete" });
          continue;
        }
        if (retained.state === "complete") {
          operation = remove ? "remove" : "update";
        } else {
          attempted = true;
          throw Error(
            "A pack mutation has an unconfirmed outcome. Inspect native Claws before an explicit change; startup will not repeat it.",
          );
        }
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
      if (
        (await openPack(pack.directory)).digest !== pack.digest ||
        (pack.bindingsFile &&
          fingerprint(await readFile(pack.bindingsFile)) !==
            pack.bindingsDigest)
      )
        throw Error(
          "Selected pack inputs changed. Review a new installation plan.",
        );
      report(
        `${operation === "remove" ? "Removing" : operation === "update" ? "Updating" : "Installing"} pack member ${member}…`,
      );
      const plan = await planPack(
        {
          directory: pack.directory,
          member,
          operation,
          workspace: `/home/node/.openclaw/workspace-${member}`,
          ...(pack.bindingsFile ? { bindingsFile: pack.bindingsFile } : {}),
        },
        native,
      );
      await writePrivate(
        join(receipts, member + "-plan.json"),
        JSON.stringify(plan),
      );
      attempted = true;
      await writePrivate(
        path,
        JSON.stringify({
          ownerId: state.ownerId,
          selectionDigest,
          state: "pending",
        }),
      );
      await applyPack(plan, native, pack.bindingsFile);
      await writePrivate(
        path,
        JSON.stringify({
          ownerId: state.ownerId,
          selectionDigest,
          state: "complete",
        }),
      );
      if (remove) {
        await rm(path);
        await rm(join(receipts, member + "-plan.json"));
      }
      outcomes.push({ member, state: "complete" });
    } catch {
      const state = attempted ? "unconfirmed" : "blocked";
      outcomes.push({ member, state });
      report(
        `Pack member ${member}: ${state}. Inspect its native Claws plan and prerequisites; no mutation was replayed. The team server remains available.`,
      );
    }
  }
  await writePrivate(
    join(directory, "pack-status.json"),
    JSON.stringify(outcomes),
  );
  return outcomes;
}
