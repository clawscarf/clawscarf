import { z } from "zod";
import { cloudUrlSchema } from "./url.js";
import { gatewayRoutesSchema } from "../models/configuration.js";
import type { ModelCatalog } from "../models/catalog.js";
import type { AiModel } from "../../services/cloud/generated/types.gen.js";

export const cloudModelsSchema = z.array(
  z.object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/),
    name: z.string().min(1),
    protocols: z.array(z.enum(["responses", "chat/completions"])).min(1),
    contextTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    supportsTemperature: z.boolean(),
    reasoningEfforts: z
      .array(
        z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
      )
      .max(7),
    inputMicrosPerMillion: z.number().int().nonnegative(),
    outputMicrosPerMillion: z.number().int().nonnegative(),
    rateVersion: z.string().min(1),
  }),
);
export const cloudAiVariable = "CLAWSCARF_CLOUD_AI_KEY";

/** Cloud IDs are model names, never a provider destination or credential. */
export function cloudModelCatalog(
  models: AiModel[],
  url: string,
): ModelCatalog {
  const base = cloudUrlSchema.parse(url) + "/v1";
  return cloudModelsSchema.parse(models).map((model) => ({
    provider: "ClawScarf Cloud",
    model: {
      id: model.id,
      name: model.name,
      enabled: true,
      api: model.protocols.includes("responses")
        ? "openai-responses"
        : "openai-completions",
      contextWindow: model.contextTokens,
      maxTokens: model.maxOutputTokens,
      reasoning: model.reasoningEfforts.some((effort) => effort !== "none"),
      compat: {
        supportsTemperature: model.supportsTemperature,
        supportedReasoningEfforts: model.reasoningEfforts,
      },
      tools: true,
      input: ["text"],
      route: {
        model: `openai/${model.id}`,
        apiKeyEnv: cloudAiVariable,
        apiBase: base,
      },
    },
    reasoningLevels: (["low", "medium", "high"] as const).filter((effort) =>
      model.reasoningEfforts.includes(effort),
    ),
  }));
}

export function validateCloudRoutes(value: unknown, url: string) {
  const routes = gatewayRoutesSchema.parse(value);
  const base = cloudUrlSchema.parse(url) + "/v1";
  for (const model of routes.models) {
    if (
      model.route?.apiBase !== base ||
      model.route.apiKeyEnv !== cloudAiVariable ||
      model.route.model !== `openai/${model.id}`
    )
      throw Error(
        "Cloud AI models must use their scoped ClawScarf Cloud endpoint.",
      );
  }
  return routes;
}
