import { z } from "zod";
import { installationSchema } from "../configuration.js";

/** Recipes are CLI-owned defaults, never executable installation hooks. */
export const recipeSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
  runtime: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  maturity: z.enum(["example", "supported"]),
  defaults: z.strictObject({
    agentName: installationSchema.shape.agentName,
    resources: installationSchema.shape.resources,
    browser: installationSchema.shape.browser,
    publicWeb: z.boolean().default(false),
    connections: z.strictObject({ enabled: z.boolean() }).optional(),
  }),
  models: z.union([
    z.strictObject({
      service: z.literal("cloud"),
      model: z.string().min(1),
      reasoning: z.enum(["low", "medium", "high"]).optional(),
    }),
    z.strictObject({
      service: z.literal("provider").default("provider"),
      model: z.string().min(1),
      provider: z.string().min(1),
      reasoning: z.enum(["low", "medium", "high"]).optional(),
    }),
  ]),
  packs: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        members: installationSchema.shape.packs.element.shape.members,
      }),
    )
    .max(32)
    .default([]),
});
export type Recipe = z.infer<typeof recipeSchema>;
export const recipesSchema = z
  .array(recipeSchema)
  .max(32)
  .refine(
    (recipes) =>
      new Set(recipes.map((recipe) => recipe.id)).size === recipes.length,
    "Recipe IDs must be unique.",
  );
