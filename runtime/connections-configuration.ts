import { X509Certificate } from "node:crypto";
import { z } from "zod";

const maximumBytes = 1024 * 1024;
const brokerUrl = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  });
const credentialSchema = z.strictObject({
  token: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[\x21-\x7e]+$/u),
  ca: z
    .string()
    .min(1)
    .max(maximumBytes)
    .refine((value) => {
      try {
        new X509Certificate(value);
        return true;
      } catch {
        return false;
      }
    })
    .optional(),
});
export const connectionsConfigurationInputSchema = z
  .strictObject({
    kind: z.enum(["configure", "observe"]),
    ownerId: z.uuid(),
    serverId: z.uuid(),
    brokerUrl,
    credential: credentialSchema.optional(),
  })
  .refine(
    (value) => value.kind !== "configure" || value.credential !== undefined,
    "Configuration requires a scoped credential.",
  );
export type ConnectionsConfigurationInput = z.infer<
  typeof connectionsConfigurationInputSchema
>;
export const nativeConnectionsConfigurationResultSchema = z.discriminatedUnion(
  "state",
  [
    z.strictObject({ state: z.literal("not_installed") }),
    z.strictObject({
      state: z.literal("unconfigured"),
      enabled: z.boolean(),
      expectedPackage: z.boolean(),
    }),
    z.strictObject({
      state: z.literal("configured"),
      enabled: z.boolean(),
      brokerUrl,
      configHash: z.string().min(1).max(256),
    }),
  ],
);
export const connectionsConfigurationResultSchema = z.discriminatedUnion(
  "state",
  [
    nativeConnectionsConfigurationResultSchema.options[0].extend({
      credentialMatches: z.boolean().optional(),
    }),
    nativeConnectionsConfigurationResultSchema.options[1].extend({
      credentialMatches: z.boolean().optional(),
    }),
    nativeConnectionsConfigurationResultSchema.options[2].extend({
      credentialMatches: z.boolean().optional(),
    }),
  ],
);
export type ConnectionsConfigurationResult = z.infer<
  typeof connectionsConfigurationResultSchema
>;
