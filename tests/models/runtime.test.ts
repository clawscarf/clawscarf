import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { configure, parseInput } from "../../runtime/models.js";
import {
  configurationSchema,
  nativeAssignments,
} from "../../scripts/models/configuration.js";
await test(
  "native runtime configuration persists scoped SecretRefs without process credentials",
  { skip: process.env.CLAWSCARF_TEST_NATIVE_MODELS !== "1" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-model-runtime-"));
    const executable = resolve(
      "plugins/connections/node_modules/.bin/openclaw",
    );
    try {
      const existing = {
        gateway: { mode: "local" },
        models: {
          providers: {
            clawscarf: {
              baseUrl: "http://127.0.0.1:14000/v1",
              api: "openai-completions",
              models: [{ id: "old", name: "Old" }],
              headers: { "x-previous": "remove-me" },
            },
          },
        },
        agents: {
          defaults: {
            model: { primary: "customer/own", fallbacks: ["customer/own"] },
          },
        },
      };
      await writeFile(
        join(directory, "openclaw.json"),
        JSON.stringify(existing),
      );
      const configuration = configurationSchema.parse({
        mode: "external",
        baseUrl: "https://gateway.internal/v1",
        defaultModel: "team",
        models: [
          {
            id: "team",
            name: "Team",
            enabled: true,
            contextWindow: 10000,
            maxTokens: 1000,
            reasoning: false,
            tools: true,
            input: ["text"],
          },
        ],
      });
      const input = parseInput({
        assignments: nativeAssignments(configuration),
        token: "scoped-test-token",
        ca: "public-test-ca",
        apply: false,
      });
      assert.equal(
        await configure(input, { stateDirectory: directory, executable }),
        "validated",
      );
      assert.deepEqual(
        JSON.parse(await readFile(join(directory, "openclaw.json"), "utf8")),
        existing,
      );
      assert.deepEqual(await readdir(join(directory, "clawscarf-models")), []);
      assert.equal(
        await configure(
          { ...input, apply: true },
          { stateDirectory: directory, executable },
        ),
        "configured_restart_required",
      );
      const schema = z.object({
        secrets: z.object({
          providers: z.object({
            "clawscarf-models": z.object({
              source: z.literal("file"),
              path: z.string(),
            }),
          }),
        }),
        models: z.object({
          providers: z.object({
            clawscarf: z.object({
              apiKey: z.object({
                source: z.literal("file"),
                id: z.literal("/token"),
              }),
            }),
          }),
        }),
      });
      const config = schema.parse(
        JSON.parse(await readFile(join(directory, "openclaw.json"), "utf8")),
      );
      assert.ok(
        !(await readFile(join(directory, "openclaw.json"), "utf8")).includes(
          "x-previous",
        ),
      );
      const first = config.secrets.providers["clawscarf-models"].path;
      assert.equal((await stat(first)).mode & 0o777, 0o600);
      assert.equal(
        await readFile(join(directory, "clawscarf-models", "ca.pem"), "utf8"),
        input.ca,
      );
      assert.equal(
        (await stat(join(directory, "clawscarf-models"))).mode & 0o777,
        0o700,
      );
      assert.deepEqual(JSON.parse(await readFile(first, "utf8")), {
        token: input.token,
        ca: input.ca,
      });
      assert.ok(
        !(await readFile(join(directory, "openclaw.json"), "utf8")).includes(
          input.token,
        ),
      );
      assert.equal(
        await configure(
          { ...input, token: "rotated-token", apply: true },
          { stateDirectory: directory, executable },
        ),
        "configured",
      );
      await stat(first);
      assert.equal(
        (await readdir(join(directory, "clawscarf-models"))).length,
        3,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
