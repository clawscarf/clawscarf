import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { issueRuntimeCredential } from "../../scripts/models/credentials.js";
import { configurationSchema } from "../../scripts/models/configuration.js";
import { run } from "../../scripts/deployment/process.js";

await test(
  "Cloud model IDs and quota errors survive the pinned LiteLLM chat and Responses paths without replay",
  { skip: process.env.CLAWSCARF_TEST_CLOUD_GATEWAY !== "1", timeout: 180000 },
  async (t) => {
    const masterKeyFile = process.env.CLAWSCARF_TEST_LITELLM_MASTER_KEY_FILE;
    const configurationFile = process.env.CLAWSCARF_TEST_MODEL_CONFIGURATION;
    assert.ok(masterKeyFile);
    assert.ok(configurationFile);
    const configuration = configurationSchema.parse(
      JSON.parse(await readFile(configurationFile, "utf8")),
    );
    assert.equal(configuration.mode, "litellm");
    const origin = configuration.baseUrl.replace(/\/v1$/, ""),
      model = configuration.defaultModel;
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-cloud-route-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    let failure = 0,
      calls = 0;
    let failOnce = false;
    const attempts: number[] = [];
    let expectsBrowser: boolean | undefined;
    const observed: string[] = [];
    const upstream = createServer((request, response) => {
      void (async () => {
        calls++;
        attempts.push(Date.now());
        observed.push(request.url ?? "");
        assert.equal(
          request.headers.authorization,
          "Bearer scoped-test-cloud-secret",
        );
        const chunks: Buffer[] = [];
        for await (const chunk of request)
          chunks.push(
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
          );
        const body = z
          .object({
            model: z.literal(model),
            stream: z.boolean().optional(),
            tools: z.array(z.record(z.string(), z.unknown())).optional(),
          })
          .passthrough()
          .parse(JSON.parse(Buffer.concat(chunks).toString()));
        response.setHeader("content-type", "application/json");
        if (expectsBrowser !== undefined) {
          const names = (body.tools ?? []).map(
            (tool) =>
              tool.name ??
              z.object({ name: z.string() }).parse(tool.function).name,
          );
          assert.equal(names.includes("browser"), expectsBrowser);
        }
        if (failure) {
          const status = failure;
          if (failOnce) failure = 0;
          response.statusCode = status;
          if (status === 429) response.setHeader("Retry-After", "5");
          response.end(
            JSON.stringify({
              error: {
                message:
                  status === 429
                    ? "ClawScarf Cloud AI is busy with other requests on this account. Retry shortly."
                    : "ClawScarf Cloud AI credits have run out. Ask an administrator to open Account to add credits.",
                type:
                  status === 429 ? "rate_limit_error" : "invalid_request_error",
                code: status === 429 ? "inference_busy" : "credit_exhausted",
                param: null,
              },
              requestId: "fixture",
            }),
          );
          return;
        }
        if (request.url === "/v1/responses") {
          const result = {
            id: "resp_cloud_fixture",
            object: "response",
            created_at: 1,
            status: "completed",
            model,
            output: [
              {
                id: "msg_fixture",
                type: "message",
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: "Cloud Responses works",
                    annotations: [],
                  },
                ],
              },
            ],
            usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
          };
          if (body.stream) {
            response.setHeader("content-type", "text/event-stream");
            response.end(
              `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { ...result, status: "in_progress", output: [] }, sequence_number: 0 })}\n\nevent: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", item_id: "msg_fixture", output_index: 0, content_index: 0, delta: "Cloud Responses works", sequence_number: 1 })}\n\nevent: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: result, sequence_number: 2 })}\n\n`,
            );
          } else response.end(JSON.stringify(result));
          return;
        }
        if (body.stream) {
          response.setHeader("content-type", "text/event-stream");
          response.end(
            `data: ${JSON.stringify({ id: "chatcmpl-cloud", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: { role: "assistant", content: "Cloud stream works" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "chatcmpl-cloud", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
          );
          return;
        }
        response.end(
          JSON.stringify({
            id: "chatcmpl-cloud",
            object: "chat.completion",
            created: 1,
            model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Cloud chat works" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
          }),
        );
      })().catch((error: unknown) => {
        response.statusCode = 500;
        response.end(
          JSON.stringify({
            error: {
              message:
                error instanceof Error ? error.message : "Fixture failed",
            },
          }),
        );
      });
    });
    upstream.listen(14501, "0.0.0.0");
    await once(upstream, "listening");
    t.after(
      () =>
        new Promise<void>((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const keyFile = join(directory, "runtime-key");
    await issueRuntimeCredential({
      origin,
      masterKeyFile,
      output: keyFile,
      configuration,
    });
    const key = (await readFile(keyFile, "utf8")).trim();
    t.after(async () => {
      await fetch(origin + "/key/delete", {
        method: "POST",
        headers: {
          authorization: `Bearer ${(await readFile(masterKeyFile, "utf8")).trim()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ keys: [key] }),
      });
    });
    for (const protocol of ["chat/completions", "responses"]) {
      for (const stream of [false, true]) {
        for (const status of [200, 402, 429]) {
          failure = status === 200 ? 0 : status;
          const before = calls;
          const response = await fetch(origin + "/v1/" + protocol, {
            method: "POST",
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model,
              ...(protocol === "responses"
                ? { input: "Hello" }
                : { messages: [{ role: "user", content: "Hello" }] }),
              stream,
            }),
            signal: AbortSignal.timeout(15000),
          });
          const text = await response.text();
          assert.equal(response.status, status, text);
          if (status === 402) {
            assert.match(text, /402/);
            assert.match(text, /Account/);
          } else if (status === 429) {
            // The pinned LiteLLM drops Retry-After on errors. Native OpenClaw
            // must recover using its standard bounded rate-limit backoff.
            assert.equal(response.headers.get("retry-after"), null);
            assert.match(text, /busy with other requests/);
          } else assert.match(text, /Cloud (Responses|chat|stream) works/);
          assert.equal(calls - before, 1, "one upstream attempt per request");
        }
      }
    }
    assert.ok(observed.includes("/v1/responses"));
    assert.ok(observed.includes("/v1/chat/completions"));
    const image = process.env.CLAWSCARF_TEST_CLOUD_NATIVE_IMAGE;
    if (image) {
      for (const [api, browser] of [
        ["openai-completions", false],
        ["openai-responses", true],
      ] as const) {
        const nativeOrigin = new URL(origin);
        nativeOrigin.hostname = "host.docker.internal";
        await writeFile(
          join(directory, "native.json"),
          JSON.stringify({
            gateway: { mode: "local" },
            browser: { enabled: browser },
            plugins: { entries: { browser: { enabled: browser } } },
            models: {
              providers: {
                clawscarf: {
                  baseUrl: nativeOrigin.href.replace(/\/$/, "") + "/v1",
                  api,
                  apiKey: key,
                  models: [
                    {
                      id: model,
                      name: "Cloud fixture",
                      contextWindow: 128000,
                      maxTokens: 1024,
                    },
                  ],
                },
              },
            },
            agents: {
              defaults: {
                model: { primary: `clawscarf/${model}` },
                workspace: "/tmp/workspace",
              },
            },
          }),
          { mode: 0o600 },
        );
        expectsBrowser = browser;
        failure = 429;
        failOnce = true;
        const before = calls;
        const output = await run(
          "docker",
          [
            "run",
            "--rm",
            "--add-host",
            "host.docker.internal:host-gateway",
            "--mount",
            `type=bind,source=${directory},target=/fixture,readonly`,
            "--tmpfs",
            "/tmp:rw,mode=1777",
            "--env",
            "HOME=/tmp/native-home",
            "--env",
            "OPENCLAW_CONFIG_PATH=/fixture/native.json",
            "--env",
            "OPENCLAW_STATE_DIR=/tmp/native-state",
            "--entrypoint",
            "node",
            image,
            "/app/openclaw.mjs",
            "agent",
            "--local",
            "--agent",
            "main",
            "--session-id",
            crypto.randomUUID(),
            "--message",
            "Reply hello without tools.",
            "--json",
          ],
          { timeout: 90000 },
        );
        assert.match(output, /Cloud (Responses|chat|stream) works/);
        assert.equal(
          calls - before,
          2,
          "native runtime retries the rejected request once",
        );
        assert.ok(
          (attempts[before + 1] ?? 0) - (attempts[before] ?? 0) >= 500,
          "native rate-limit recovery waits instead of retrying immediately",
        );
      }
    }
  },
);
