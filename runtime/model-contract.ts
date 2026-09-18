import { z } from "zod";

const assignmentSchema = z.discriminatedUnion("path", [
  z.strictObject({
    path: z.literal("secrets.providers.clawscarf-models"),
    value: z.strictObject({
      source: z.literal("env"),
      allowlist: z.tuple([z.literal("CLAWSCARF_MODEL_TOKEN")]),
    }),
  }),
  z.strictObject({
    path: z.literal("models.providers.clawscarf"),
    value: z.strictObject({
      baseUrl: z.url(),
      api: z.literal("openai-completions"),
      agentRuntime: z.strictObject({ id: z.literal("openclaw") }),
      apiKey: z.strictObject({
        source: z.literal("env"),
        provider: z.literal("clawscarf-models"),
        id: z.literal("CLAWSCARF_MODEL_TOKEN"),
      }),
      models: z
        .array(
          z.strictObject({
            id: z.string().min(1),
            name: z.string().min(1),
            api: z.enum(["openai-completions", "openai-responses"]).optional(),
            input: z.array(z.enum(["text", "image"])).min(1),
            reasoning: z.boolean(),
            contextWindow: z.number().int().positive(),
            maxTokens: z.number().int().positive(),
            compat: z.strictObject({
              supportsTools: z.boolean(),
              supportsUsageInStreaming: z.literal(true),
              supportsStrictMode: z.literal(true),
            }),
          }),
        )
        .min(1)
        .max(512),
    }),
  }),
  z.strictObject({
    path: z.literal("agents.defaults.model.primary"),
    value: z.string().startsWith("clawscarf/").min(11),
  }),
  z.strictObject({
    path: z.literal("agents.defaults.thinkingDefault"),
    value: z.enum(["low", "medium", "high"]),
  }),
]);
export const modelInputSchema = z
  .strictObject({
    assignments: z.array(assignmentSchema).min(2).max(4),
    token: z.string().trim().min(1).max(65536),
    ca: z.string().min(1).max(262144).nullable(),
    apply: z.boolean(),
  })
  .superRefine(({ assignments }, context) => {
    const paths = new Set(assignments.map((assignment) => assignment.path));
    if (
      paths.size !== assignments.length ||
      !paths.has("models.providers.clawscarf") ||
      !paths.has("secrets.providers.clawscarf-models")
    )
      context.addIssue({
        code: "custom",
        message: "Require unique paths and both provider assignments.",
      });
  });
export type ModelInput = z.infer<typeof modelInputSchema>;
export const modelFailureCodeSchema = z.enum([
  "invalid_input",
  "invalid_state",
  "unavailable",
  "validation_rejected",
  "outcome_unknown",
]);
export type ModelFailureCode = z.infer<typeof modelFailureCodeSchema>;
export class ModelConfigurationError extends Error {
  constructor(readonly code: ModelFailureCode) {
    super(code);
    this.name = "ModelConfigurationError";
  }
}
export const modelStateSchema = z.enum([
  "configured",
  "configured_restart_required",
  "validated",
]);
export type ModelState = z.infer<typeof modelStateSchema>;
export const modelResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    state: modelStateSchema,
  }),
  z.strictObject({ ok: z.literal(false), error: modelFailureCodeSchema }),
]);
