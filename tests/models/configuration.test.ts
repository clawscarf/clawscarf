import assert from "node:assert/strict";
import { test } from "node:test";
import {
  configurationSchema,
  liteLlmConfiguration,
  nativeAssignments,
  nativeModelProvider,
} from "../../scripts/models/configuration.js";
import { modelInputSchema } from "../../runtime/model-contract.js";
import {
  cloudModelCatalog,
  cloudModelsSchema,
} from "../../scripts/cloud/models.js";
import { installationCatalog } from "../../scripts/installation/recipes/catalog.js";
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
  assert.equal(provider.models[1]?.compat.supportsStrictMode, true);
  assert.ok(
    modelInputSchema.safeParse({
      assignments: nativeAssignments(config),
      token: "test-scoped-token",
      ca: null,
      apply: true,
    }).success,
  );
  assert.equal(config.thinkingDefault, "medium");
});

await test("Cloud and provider-key offerings keep canonical model IDs and explicit model capabilities", async () => {
  const { modelCatalog } = await installationCatalog();
  const hosted = modelCatalog.filter(
    (offer) => offer.provider === "ClawScarf Cloud",
  );
  assert.ok(hosted.length >= 25);
  for (const offer of hosted) {
    assert.ok(!offer.model.id.includes("/"));
    assert.ok(
      modelCatalog.some(
        (own) =>
          own.provider !== "ClawScarf Cloud" && own.model.id === offer.model.id,
      ),
    );
    assert.ok(offer.model.compat);
    assert.equal(offer.model.route.model, `openai/${offer.model.id}`);
    assert.equal(offer.model.route.apiBase, "https://cloud.clawscarf.com/v1");
  }
  for (const id of ["gpt-6-astra", "gpt-6-astra-pro", "claude-fable-5-1"]) {
    const model = hosted.find((offer) => offer.model.id === id)?.model;
    assert.ok(model);
    const config = configurationSchema.parse({
      ...input,
      models: [model],
      defaultModel: id,
    });
    if (config.mode === "disabled") throw Error("Expected enabled models");
    const native = nativeModelProvider(config).models[0];
    assert.ok(native);
    assert.equal(native.id, id);
    assert.equal(native.compat.supportsTemperature, false);
    assert.deepEqual(native.compat.supportedReasoningEfforts, [
      "max",
      "xhigh",
      "high",
      "medium",
      "low",
    ]);
    assert.ok(
      modelInputSchema.safeParse({
        assignments: nativeAssignments(config),
        token: "scoped-test-token",
        ca: null,
        apply: true,
      }).success,
    );
  }
  assert.ok(
    hosted
      .find((offer) => offer.model.id === "gpt-6-luna")
      ?.model.compat?.supportedReasoningEfforts.includes("none"),
  );
});

await test("Cloud model capabilities cannot silently disappear from discovery", () => {
  const model = {
    id: "new-model",
    name: "New model",
    protocols: ["responses" as const],
    contextTokens: 8192,
    maxOutputTokens: 1024,
    replyBudgetTokens: 1024,
    inputMicrosPerMillion: 1,
    outputMicrosPerMillion: 1,
    rateVersion: "test",
  };
  assert.equal(cloudModelsSchema.safeParse([model]).success, false);
  const catalog = cloudModelCatalog(
    [{ ...model, supportsTemperature: true, reasoningEfforts: [] }],
    "https://cloud.example.test",
  );
  assert.equal(catalog[0]?.model.reasoning, false);
  assert.deepEqual(catalog[0]?.reasoningLevels, []);
});

await test("Cloud reply budgets configure native request parameters without lowering advertised capability", () => {
  const catalog = cloudModelCatalog(
    [
      {
        id: "gpt-6-astra",
        name: "Astra",
        protocols: ["responses"],
        contextTokens: 1000000,
        maxOutputTokens: 128000,
        replyBudgetTokens: 32768,
        supportsTemperature: false,
        reasoningEfforts: ["low", "medium", "high"],
        inputMicrosPerMillion: 1,
        outputMicrosPerMillion: 1,
        rateVersion: "test",
      },
    ],
    "https://cloud.example.test",
  );
  const config = configurationSchema.parse({
    mode: "external",
    baseUrl: "https://gateway.example.test/v1",
    defaultModel: "gpt-6-astra",
    models: catalog.map((entry) => entry.model),
  });
  const assignments = nativeAssignments(config);
  assert.deepEqual(
    assignments.find((a) => a.path === "agents.defaults.models")?.value,
    {
      "clawscarf/gpt-6-astra": { params: { maxTokens: 32768 } },
    },
  );
  assert.equal(catalog[0]?.model.maxTokens, 128000);
  assert.equal(
    modelInputSchema.safeParse({
      assignments,
      token: "test",
      ca: null,
      apply: true,
    }).success,
    true,
  );
});
