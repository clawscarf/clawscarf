import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { openPack } from "./source.js";
import { requirements } from "./requirements.js";
import type { NativeClaws } from "./native.js";
import { planSchema, type Member, type PackPlan } from "./model.js";
function argumentsFor(
  operation: PackPlan["operation"],
  root: string,
  member: Member,
  workspace: string,
) {
  return operation === "add"
    ? [
        "claws",
        "add",
        join(root, member.source),
        "--agent-id",
        member.id,
        "--workspace",
        workspace,
      ]
    : operation === "update"
      ? ["claws", "update", member.id, "--from", join(root, member.source)]
      : ["claws", "remove", member.id];
}
export async function inspectPack(directory: string, native: NativeClaws) {
  await native.version();
  const source = await openPack(directory);
  const members = [];
  for (const member of source.manifest.members)
    members.push({
      id: member.id,
      native: await native.run([
        "claws",
        "inspect",
        join(source.root, member.source),
        "--json",
      ]),
    });
  return { pack: source.manifest, digest: source.digest, members };
}
export async function planPack(
  input: {
    directory: string;
    member: string;
    operation: PackPlan["operation"];
    workspace: string;
    bindingsFile?: string;
  },
  native: NativeClaws,
): Promise<PackPlan> {
  await native.version();
  const source = await openPack(input.directory);
  const member = source.manifest.members.find(
    (item) => item.id === input.member,
  );
  if (!member) throw Error("Unknown pack member.");
  const verified =
    input.operation === "remove"
      ? { model: null, connections: [] }
      : await requirements(source.manifest, member, native, input.bindingsFile);
  const workspace = resolve(input.workspace);
  const nativePlan = await native.run([
    ...argumentsFor(input.operation, source.root, member, workspace),
    "--dry-run",
    "--json",
  ]);
  const validated = z
    .object({
      schemaVersion: z.literal(
        {
          add: "openclaw.clawAddPlan.v1",
          update: "openclaw.clawUpdatePlan.v1",
          remove: "openclaw.clawRemovePlan.v1",
        }[input.operation],
      ),
      stability: z.literal("experimental"),
      planIntegrity: z.string(),
      diagnostics: z.array(z.object({ level: z.string() })).optional(),
      summary: z
        .object({
          blockedActions: z.number().optional(),
          blocked: z.number().optional(),
        })
        .optional(),
    })
    .parse(nativePlan);
  if (
    validated.summary?.blockedActions ||
    validated.summary?.blocked ||
    validated.diagnostics?.some((item) => item.level === "error")
  )
    throw Error(
      "Native Claw plan is blocked; inspect it with openclaw claws before applying.",
    );
  return planSchema.parse({
    schemaVersion: 1,
    pack: source.root,
    packDigest: source.digest,
    member: member.id,
    operation: input.operation,
    workspace,
    nativePlan,
    planIntegrity: validated.planIntegrity,
    requirements: verified,
  });
}
export async function applyPack(
  value: unknown,
  native: NativeClaws,
  bindingsFile?: string,
) {
  const plan = planSchema.parse(value);
  const source = await openPack(plan.pack);
  if (source.digest !== plan.packDigest)
    throw Error("Pack sources changed; review a new plan.");
  const fresh = await planPack(
    {
      directory: source.root,
      member: plan.member,
      operation: plan.operation,
      workspace: plan.workspace,
      ...(bindingsFile ? { bindingsFile } : {}),
    },
    native,
  );
  if (
    fresh.planIntegrity !== plan.planIntegrity ||
    !isDeepStrictEqual(fresh.requirements, plan.requirements)
  )
    throw Error("Native state or requirements changed; review a new plan.");
  const member = source.manifest.members.find(
    (item) => item.id === plan.member,
  );
  if (!member) throw Error("Pack member disappeared.");
  return native.run([
    ...argumentsFor(plan.operation, source.root, member, plan.workspace),
    "--yes",
    "--plan-integrity",
    plan.planIntegrity,
    "--json",
  ]);
}
