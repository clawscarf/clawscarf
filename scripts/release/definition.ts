import { cloudUrlSchema } from "../cloud/url.js";
import { z } from "zod";
import { modelSchema } from "../models/configuration.js";
import { recipesSchema } from "../installation/recipes/definition.js";

import { liteLlmImage, postgresImage } from "../deployment/images.js";

export const digest = z.string().regex(/^[a-f0-9]{64}$/);
const image = z
  .string()
  .regex(
    /^(?:sha256:[a-f0-9]{64}|[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64})$/,
  );
const file = z.strictObject({ file: z.string().min(1), sha256: digest });
/** Release metadata is build output, not deployment state or customer configuration. */
export const releaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  cloudUrl: cloudUrlSchema.optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
  recipes: recipesSchema,
  packs: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      }),
    )
    .max(32)
    .default([])
    .refine(
      (packs) => new Set(packs.map((pack) => pack.id)).size === packs.length,
      "Release pack IDs must be unique.",
    ),
  modelCatalog: z
    .array(
      z.strictObject({
        provider: z.string().min(1),
        model: modelSchema.extend({ route: modelSchema.shape.route.unwrap() }),
        reasoningLevels: z.array(z.enum(["low", "medium", "high"])),
      }),
    )
    .max(512)
    .optional(),
  connectorCatalogDirectory: z.string().min(1).optional(),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  platforms: z.array(z.literal("darwin-arm64")).min(1).max(1),
  images: z.strictObject({
    postgres: z.literal(postgresImage),
    gateway: image,
    worker: image,
    companion: image,
    openshellClient: image,
    relay: image,
    models: z.literal(liteLlmImage).optional(),
    browser: z
      .strictObject({ chromium: image, node: image, dns: image, egress: image })
      .optional(),
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
