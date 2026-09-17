import assert from "node:assert/strict";
import { test } from "node:test";
import {
  configurationSchema,
  liteLlmConfiguration,
  nativeAssignments,
  nativeModelProvider,
} from "../../scripts/models/configuration.js";
const input = {
  mode: "litellm",
  baseUrl: "http://127.0.0.1:14000/v1",
  defaultModel: "one",
  models: [
    {
      id: "one",
      name: "One",
      enabled: true,
      contextWindow: 10000,
      maxTokens: 1000,
      reasoning: false,
      tools: true,
      input: ["text"],
      route: { model: "openai/one", apiKeyEnv: "PROVIDER_KEY" },
    },
  ],
};
await test("gateway and native configuration separate upstream secrets and runtime credentials", () => {
  const config = configurationSchema.parse(input);
  const native = nativeAssignments(config);
  assert.deepEqual(
    native.map((item) => item.path),
    [
      "secrets.providers.clawscarf-models",
      "models.providers.clawscarf",
      "agents.defaults.model.primary",
    ],
  );
  assert.ok(JSON.stringify(native).includes("CLAWSCARF_MODEL_TOKEN"));
  assert.ok(!JSON.stringify(native).includes("PROVIDER_KEY"));
  const gateway = liteLlmConfiguration(config);
  assert.equal(
    gateway.model_list[0]?.litellm_params.api_key,
    "os.environ/PROVIDER_KEY",
  );
  assert.equal(
    gateway.general_settings.master_key,
    "os.environ/LITELLM_MASTER_KEY",
  );
  assert.equal(gateway.litellm_settings.num_retries, 0);
});
await test("disabled mode has no native writes and selected defaults must be enabled", () => {
  assert.deepEqual(
    nativeAssignments(configurationSchema.parse({ mode: "disabled" })),
    [],
  );
  assert.throws(() =>
    configurationSchema.parse({ ...input, defaultModel: "missing" }),
  );
  assert.throws(() =>
    configurationSchema.parse({
      ...input,
      models: [...input.models, ...input.models],
    }),
  );
  const config = configurationSchema.parse({ ...input, defaultModel: null });
  assert.ok(
    !nativeAssignments(config).some((entry) => entry.path.startsWith("agents")),
  );
});

await test("runtime gateway transport requires TLS outside loopback", () => {
  for (const baseUrl of [
    "http://gateway.internal/v1",
    "https://user:secret@gateway.internal/v1",
    "https://gateway.internal/v1?key=secret",
    "https://gateway.internal/v1#fragment",
  ])
    assert.equal(
      configurationSchema.safeParse({ ...input, baseUrl }).success,
      false,
    );
  assert.equal(
    configurationSchema.safeParse({
      ...input,
      baseUrl: "https://gateway.internal/v1",
    }).success,
    true,
  );
});

await test("per-model protocols preserve Responses reasoning/tools alongside Chat Completions", () => {
  const config = configurationSchema.parse({
    ...input,
    thinkingDefault: "medium",
    models: [
      input.models[0],
      {
        ...input.models[0],
        id: "responses",
        reasoning: true,
        api: "openai-responses",
      },
    ],
  });
  assert.notEqual(config.mode, "disabled");
  if (config.mode === "disabled") throw Error("Expected enabled models");
  const provider = nativeModelProvider(config);
  assert.equal(provider.api, "openai-completions");
  assert.equal(provider.models[0]?.api, undefined);
  assert.equal(provider.models[1]?.api, "openai-responses");
  assert.equal(provider.models[1]?.reasoning, true);
  assert.equal(provider.models[1]?.compat.supportsTools, true);
  assert.equal(config.thinkingDefault, "medium");
});
