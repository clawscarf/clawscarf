import { OperatorError } from "../errors.js";
import { z } from "zod";
import { modelCapabilitiesSchema } from "../../runtime/model-contract.js";
export const modelSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/),
  name: z.string().min(1).max(200),
  api: z.enum(["openai-completions", "openai-responses"]).optional(),
  enabled: z.boolean(),
  contextWindow: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  replyBudgetTokens: z.number().int().positive().optional(),
  reasoning: z.boolean(),
  compat: modelCapabilitiesSchema.optional(),
  tools: z.boolean(),
  input: z.array(z.enum(["text", "image"])).min(1),
  route: z
    .strictObject({
      model: z.string().min(1).max(200),
      apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
      apiBase: z.url().optional(),
    })
    .optional(),
});
const thinkingDefault = z.enum(["low", "medium", "high"]);
export const gatewayRoutesSchema = z.strictObject({
  models: z.array(modelSchema).min(1).max(512),
  defaultModel: z.string().min(1),
  thinkingDefault: thinkingDefault.optional(),
});
export const configurationSchema = z
  .discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("disabled") }),
    z.strictObject({
      mode: z.enum(["external", "litellm"]),
      baseUrl: z.url(),
      models: z.array(modelSchema).min(1).max(512),
      defaultModel: z.string().nullable(),
      thinkingDefault: thinkingDefault.optional(),
    }),
  ])
  .superRefine((value, context) => {
    if (value.mode === "disabled") return;
    const url = new URL(value.baseUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname))
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "Use HTTPS, or HTTP only on loopback, without URL credentials.",
      });
    const ids = new Set(value.models.map((model) => model.id));
    if (
      ids.size !== value.models.length ||
      !value.models.some((model) => model.enabled)
    )
      context.addIssue({
        code: "custom",
        message: "Require unique models and at least one enabled model.",
      });
    if (
      value.defaultModel !== null &&
      !value.models.some(
        (model) => model.enabled && model.id === value.defaultModel,
      )
    )
      context.addIssue({
        code: "custom",
        message: "The default must be an enabled model.",
      });
    if (
      value.mode === "litellm" &&
      value.models.some((model) => model.enabled && !model.route)
    )
      context.addIssue({
        code: "custom",
        message: "Every enabled LiteLLM model needs an upstream route.",
      });
  });
export type ModelConfiguration = z.infer<typeof configurationSchema>;
export const tokenVariable = "CLAWSCARF_MODEL_TOKEN";
export type EnabledModelConfiguration = Exclude<
  ModelConfiguration,
  { mode: "disabled" }
>;
export function nativeModelProvider(config: EnabledModelConfiguration) {
  return {
    baseUrl: config.baseUrl,
    api: "openai-completions",
    agentRuntime: { id: "openclaw" },
    apiKey: {
      source: "env",
      provider: "clawscarf-models",
      id: tokenVariable,
    },
    models: config.models
      .filter((model) => model.enabled)
      .map((model) => ({
        id: model.id,
        name: model.name,
        ...(model.api ? { api: model.api } : {}),
        input: model.input,
        reasoning: model.reasoning,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        compat: {
          ...model.compat,
          supportsTools: model.tools,
          supportsUsageInStreaming: true,
          // Permit explicit strict:false on compatible routes; preserve optional tool arguments.
          supportsStrictMode: true,
        },
      })),
  };
}
export function nativeAssignments(config: ModelConfiguration) {
  if (config.mode === "disabled") return [];
  const defaults = nativeModelDefaults(config);
  const assignments: { path: string; value: unknown }[] = [
    {
      path: "secrets.providers.clawscarf-models",
      value: { source: "env", allowlist: [tokenVariable] },
    },
    {
      path: "models.providers.clawscarf",
      value: nativeModelProvider(config),
    },
  ];
  const budgets = Object.fromEntries(
    config.models
      .filter((m) => m.enabled && m.replyBudgetTokens !== undefined)
      .map((m) => [
        `clawscarf/${m.id}`,
        {
          params: {
            maxTokens: Math.min(
              m.replyBudgetTokens ?? m.maxTokens,
              m.maxTokens,
            ),
          },
        },
      ]),
  );
  if (Object.keys(budgets).length)
    assignments.push({ path: "agents.defaults.models", value: budgets });
  if (defaults.model.primary !== undefined)
    assignments.push({
      path: "agents.defaults.model.primary",
      value: defaults.model.primary,
    });
  if (defaults.thinkingDefault)
    assignments.push({
      path: "agents.defaults.thinkingDefault",
      value: defaults.thinkingDefault,
    });
  return assignments;
}
export function nativeModelDefaults(config: EnabledModelConfiguration) {
  return {
    model: {
      ...(config.defaultModel === null
        ? {}
        : { primary: `clawscarf/${config.defaultModel}` }),
    },
    ...(config.thinkingDefault
      ? { thinkingDefault: config.thinkingDefault }
      : {}),
  };
}
export function liteLlmConfiguration(config: ModelConfiguration) {
  if (config.mode !== "litellm")
    throw new OperatorError(
      "Select LiteLLM mode before rendering its configuration.",
    );
  return {
    model_list: config.models
      .filter((model) => model.enabled)
      .map((model) => {
        if (!model.route)
          throw new OperatorError("A LiteLLM route is required.");
        return {
          model_name: model.id,
          litellm_params: {
            model: model.route.model,
            api_key: `os.environ/${model.route.apiKeyEnv}`,
            ...(model.route.apiBase ? { api_base: model.route.apiBase } : {}),
            num_retries: 0,
            timeout: 300,
          },
          model_info: {
            max_input_tokens: model.contextWindow,
            max_output_tokens: model.maxTokens,
            supports_function_calling: model.tools,
            supports_reasoning: model.reasoning,
          },
        };
      }),
    litellm_settings: {
      num_retries: 0,
      request_timeout: 300,
      turn_off_message_logging: true,
      set_verbose: false,
      drop_params: false,
      telemetry: false,
    },
    router_settings: { num_retries: 0, disable_cooldowns: true },
    general_settings: {
      master_key: "os.environ/LITELLM_MASTER_KEY",
      database_url: "os.environ/DATABASE_URL",
      disable_spend_logs: true,
      disable_error_logs: true,
      store_model_in_db: false,
    },
  };
}
