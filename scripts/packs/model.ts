import { z } from "zod";
import { networkRequirementSchema, policyProofSchema } from "./policy.js";
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const packSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  openclaw: z.literal("2026.9.4"),
  description: z.string().min(1),
  members: z
    .array(
      z.strictObject({
        id,
        source: z.string().regex(/^[a-z][a-z0-9/-]*$/),
        connectionFile: z
          .string()
          .regex(/^[a-z][a-z0-9_-]*\.json$/)
          .optional(),
        requirements: z.strictObject({
          model: z.enum(["configured-default", "none"]),
          connections: z.array(
            z.strictObject({
              slot: id,
              connectorId: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),
            }),
          ),
        }),
      }),
    )
    .min(1)
    .max(32),
  execution: z.strictObject({
    location: z.literal("native-tools"),
    binaries: z.array(z.string().regex(/^[a-zA-Z0-9._+-]+$/)),
    network: z.array(networkRequirementSchema),
  }),
});
export type Pack = z.infer<typeof packSchema>;
export type Member = Pack["members"][number];
export const targetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("local") }),
  z.strictObject({
    kind: z.literal("openshell"),
    gateway: z.string().min(1),
    sandbox: z.string().min(1),
    sandboxId: z.uuid(),
  }),
]);
export type PackTarget = z.infer<typeof targetSchema>;
export const planSchema = z.strictObject({
  schemaVersion: z.literal(1),
  pack: z.string(),
  packDigest: z.string(),
  target: targetSchema,
  targetPack: z.string(),
  member: id,
  operation: z.enum(["add", "update", "remove"]),
  workspace: z.string(),
  nativePlan: z.unknown(),
  planIntegrity: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  requirements: z.object({
    model: z.string().nullable(),
    network: policyProofSchema.nullable(),
    connections: z.array(
      z.object({
        slot: z.string(),
        connectionId: z.string(),
        serverId: z.uuid(),
        revision: z.number().int(),
        name: z.string(),
        connectorId: z.string(),
      }),
    ),
  }),
});
export type PackPlan = z.infer<typeof planSchema>;
