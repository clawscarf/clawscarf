import { z } from "zod";
import { gatewayRoutesSchema } from "../../models/configuration.js";
import { installationSchema } from "../configuration.js";

/** Recipes are release-owned defaults, never executable installation hooks. */
export const recipeSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,63}$/)
    .refine((id) => id !== "custom"),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  maturity: z.enum(["example", "supported"]),
  defaults: z.strictObject({
    resources: installationSchema.shape.resources,
    browser: installationSchema.shape.browser,
  }),
  models: gatewayRoutesSchema,
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
