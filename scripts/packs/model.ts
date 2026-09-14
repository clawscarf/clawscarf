import { z } from "zod";
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
    network: z.array(z.string().min(1)),
  }),
});
export type Pack = z.infer<typeof packSchema>;
export type Member = Pack["members"][number];
export const planSchema = z.strictObject({
  schemaVersion: z.literal(1),
  pack: z.string(),
  packDigest: z.string(),
  member: id,
  operation: z.enum(["add", "update", "remove"]),
  workspace: z.string(),
  nativePlan: z.unknown(),
  planIntegrity: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  requirements: z.object({
    model: z.string().nullable(),
    connections: z.array(
      z.object({
        slot: z.string(),
        connectionId: z.string(),
        revision: z.number().int(),
      }),
    ),
  }),
});
export type PackPlan = z.infer<typeof planSchema>;
