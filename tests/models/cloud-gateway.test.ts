import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { issueRuntimeCredential } from "../../scripts/models/credentials.js";
import { configurationSchema } from "../../scripts/models/configuration.js";

await test(
  "Cloud model IDs and quota errors survive the pinned LiteLLM chat and Responses paths without replay",
  { skip: process.env.CLAWSCARF_TEST_CLOUD_GATEWAY !== "1", timeout: 60000 },
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
    let failure = false,
      calls = 0;
    const observed: string[] = [];
    const upstream = createServer((request, response) => {
      void (async () => {
        calls++;
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
          .object({ model: z.literal(model), stream: z.boolean().optional() })
          .passthrough()
          .parse(JSON.parse(Buffer.concat(chunks).toString()));
        response.setHeader("content-type", "application/json");
        if (failure) {
          response.statusCode = 402;
          response.end(
            JSON.stringify({
              error: {
                message:
                  "ClawScarf Cloud AI credits have run out. Ask an administrator to open Account to add credits.",
                type: "invalid_request_error",
                code: "credit_exhausted",
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
        for (const exhausted of [false, true]) {
          failure = exhausted;
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
          assert.equal(response.status, exhausted ? 402 : 200, text);
          if (exhausted) {
            assert.match(text, /402/);
            assert.match(text, /Account/);
          } else assert.match(text, /Cloud (Responses|chat|stream) works/);
          assert.equal(calls - before, 1, "one upstream attempt per request");
        }
      }
    }
    assert.ok(observed.includes("/v1/responses"));
    assert.ok(observed.includes("/v1/chat/completions"));
  },
);
