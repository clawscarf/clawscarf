import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { configurationSchema } from "../../scripts/models/configuration.js";
import { configureNativeModels } from "../../scripts/models/native.js";
await test(
  "native model batch preserves unrelated providers, fallback and agent overrides",
  {
    skip: process.env.CLAWSCARF_TEST_NATIVE_MODELS !== "1",
    timeout: 60000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-models-test-"));
    const previous = {
      config: process.env.OPENCLAW_CONFIG_PATH,
      state: process.env.OPENCLAW_STATE_DIR,
      token: process.env.CLAWSCARF_MODEL_TOKEN,
    };
    const configPath = join(directory, "openclaw.json");
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.OPENCLAW_STATE_DIR = directory;
    process.env.CLAWSCARF_MODEL_TOKEN = "scoped-test-credential";
    const executable = resolve(
      "plugins/connections/node_modules/.bin/openclaw",
    );
    try {
      const existing = {
        gateway: { mode: "local" },
        models: {
          providers: {
            customer: {
              api: "openai-completions",
              baseUrl: "http://127.0.0.1:14000/v1",
              models: [{ id: "own", name: "Own" }],
            },
          },
        },
        agents: {
          defaults: {
            model: { primary: "customer/own", fallbacks: ["customer/own"] },
          },
          entries: { specialist: { model: { primary: "customer/own" } } },
        },
      };
      await writeFile(configPath, JSON.stringify(existing));
      const config = configurationSchema.parse({
        mode: "external",
        baseUrl: "http://127.0.0.1:14000/v1",
        defaultModel: "team",
        models: [
          {
            id: "team",
            name: "Team",
            api: "openai-responses",
            enabled: true,
            contextWindow: 10000,
            maxTokens: 1000,
            reasoning: false,
            tools: true,
            input: ["text"],
          },
        ],
      });
      await configureNativeModels(executable, config, false);
      assert.deepEqual(
        JSON.parse(await readFile(configPath, "utf8")),
        existing,
      );
      await configureNativeModels(executable, config, true);
      const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
      const actual = z
        .object({
          models: z.object({ providers: z.record(z.string(), z.unknown()) }),
          agents: z.object({
            defaults: z.object({
              model: z.object({
                primary: z.string(),
                fallbacks: z.array(z.string()),
              }),
            }),
            entries: z.record(z.string(), z.unknown()),
          }),
        })
        .parse(parsed);
      assert.deepEqual(
        actual.models.providers.customer,
        existing.models.providers.customer,
      );
      assert.deepEqual(
        actual.agents.entries.specialist,
        existing.agents.entries.specialist,
      );
      assert.deepEqual(actual.agents.defaults.model, {
        primary: "clawscarf/team",
        fallbacks: ["customer/own"],
      });
      assert.equal(
        z
          .object({ models: z.array(z.object({ api: z.string() })) })
          .parse(actual.models.providers.clawscarf).models[0]?.api,
        "openai-responses",
      );
      await configureNativeModels(executable, { mode: "disabled" }, true);
      assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), parsed);
    } finally {
      for (const [key, value] of [
        ["OPENCLAW_CONFIG_PATH", previous.config],
        ["OPENCLAW_STATE_DIR", previous.state],
        ["CLAWSCARF_MODEL_TOKEN", previous.token],
      ]) {
        if (!key) continue;
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
