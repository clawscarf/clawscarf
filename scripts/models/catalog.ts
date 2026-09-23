import { z } from "zod";
import { modelSchema } from "./configuration.js";
export const modelCatalogSchema = z
  .array(
    z.strictObject({
      provider: z.string().min(1),
      model: modelSchema.extend({ route: modelSchema.shape.route.unwrap() }),
      reasoningLevels: z.array(z.enum(["low", "medium", "high"])),
    }),
  )
  .max(512);

export type ModelCatalog = z.infer<typeof modelCatalogSchema>;

/** Exact upstream identity, independent of the installation's billing service. */
export function modelIdentity(offer: ModelCatalog[number]) {
  return offer.provider === "ClawScarf Cloud"
    ? offer.model.id
    : offer.model.route.model.replace(/^openrouter\//, "");
}
