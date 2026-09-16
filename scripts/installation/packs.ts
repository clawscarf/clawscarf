import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { openPack } from "../packs/source.js";
import { planPack, applyPack } from "../packs/lifecycle.js";
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
  if (!selection.packs.length) return [];
  if (!selection.python) throw Error("Pack operator is missing.");
  const state = await readState(directory);
  const controller = join(directory, "controller");
  const gateway = resourceNames(state).sandbox;
  const native =
    target ??
    new OpenShellClaws({
      executable: state.input.openshellCli,
      python: selection.python,
      sandbox: gateway,
      gateway,
      env: {
        ...process.env,
        OPENCLAW_EXPERIMENTAL_CLAWS: "1",
        XDG_CONFIG_HOME: join(controller, "config"),
        XDG_STATE_HOME: join(controller, "state"),
        XDG_DATA_HOME: join(controller, "data"),
      },
    });
  const receipts = join(directory, "pack-operations");
  await mkdir(receipts, { recursive: true, mode: 0o700 });
  const outcomes: PackOutcome[] = [];
  for (const pack of selection.packs) {
    for (const member of pack.members) {
      let attempted = false;
      try {
        const path = join(receipts, member + ".json");
        const selectionDigest = fingerprint(JSON.stringify({ pack, member }));
        try {
          const retained = z
            .strictObject({
              ownerId: z.literal(state.ownerId),
              selectionDigest: z.literal(selectionDigest),
              state: z.enum(["pending", "complete"]),
            })
            .parse(await readJson(path));
          if (retained.state === "complete") {
            outcomes.push({ member, state: "complete" });
            continue;
          }
          attempted = true;
          throw Error(
            "A pack mutation has an unconfirmed outcome. Inspect native Claws before an explicit change; startup will not repeat it.",
          );
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
        report(`Installing pack member ${member}…`);
        const plan = await planPack(
          {
            directory: pack.directory,
            member,
            operation: "add",
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
        outcomes.push({ member, state: "complete" });
      } catch {
        const state = attempted ? "unconfirmed" : "blocked";
        outcomes.push({ member, state });
        report(
          `Pack member ${member}: ${state}. Inspect its native Claws plan and prerequisites; no mutation was replayed. The team server remains available.`,
        );
      }
    }
  }
  await writePrivate(
    join(directory, "pack-status.json"),
    JSON.stringify(outcomes),
  );
  return outcomes;
}
