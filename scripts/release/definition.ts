import { z } from "zod";

import { liteLlmImage, postgresImage } from "../deployment/images.js";

export const digest = z.string().regex(/^[a-f0-9]{64}$/);
const image = z
  .string()
  .regex(
    /^(?:sha256:[a-f0-9]{64}|[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64})$/,
  );
const file = z.strictObject({ file: z.string().min(1), sha256: digest });
/** Pinned runtime metadata, independent of recipe defaults and deployment state. */
export const releaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  platforms: z.array(z.literal("darwin-arm64")).min(1).max(1),
  images: z
    .strictObject({
      postgres: z.literal(postgresImage),
      gateway: image,
      companion: image,
      openshellClient: image,
      relay: image.optional(),
      models: z.literal(liteLlmImage).optional(),
      browser: z
        .strictObject({
          chromium: image,
          node: image,
          dns: image,
          egress: image,
        })
        .optional(),
    })
    .refine((images) => Boolean(images.browser) === Boolean(images.relay), {
      message: "Browser and relay images must be supplied together.",
    }),
  tools: z.strictObject({
    openshell: z.strictObject({
      version: z.string().min(1),
      cli: file,
      gateway: file,
    }),
  }),
});
export type Release = z.infer<typeof releaseSchema>;
