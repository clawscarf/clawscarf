import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { LocalSetupError } from "./process.js";

export const snapshotSchema = z.strictObject({
  create: z.string().min(1),
  effective: z.string().min(1),
  resourceVersion: z.string().regex(/^[0-9]+$/),
});
export const upgradeSchema = z.strictObject({
  ownerId: z.uuid(),
  generation: z.uuid(),
  fromImage: z.string(),
  toImage: z.string(),
  oldId: z.uuid(),
  oldContainerId: z.string().regex(/^[a-f0-9]{64}$/),
  newId: z.uuid().optional(),
  snapshot: snapshotSchema,
  stage: z.enum([
    "prepared",
    "delete_sent",
    "deleted",
    "create_sent",
    "created",
    "restore_sent",
    "restored",
    "stopped",
    "released",
    "committing",
    "complete",
  ]),
});
export type Upgrade = z.infer<typeof upgradeSchema>;
export async function readUpgrade(
  directory: string,
): Promise<Upgrade | undefined> {
  try {
    return upgradeSchema.parse(
      JSON.parse(await readFile(join(directory, "upgrade.json"), "utf8")),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}
export async function requireNoUpgrade(directory: string) {
  const upgrade = await readUpgrade(directory);
  if (upgrade && upgrade.stage !== "complete")
    throw new LocalSetupError(
      "upgrade_pending",
      "An upgrade is unfinished. Resume that upgrade before preparing or starting this installation.",
    );
}
