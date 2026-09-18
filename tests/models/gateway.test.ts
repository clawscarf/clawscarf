import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueRuntimeCredential } from "../../scripts/models/credentials.js";
import { configurationSchema } from "../../scripts/models/configuration.js";
await test(
  "pinned LiteLLM virtual keys scope inference, reject administration and revoke",
  {
    skip: process.env.CLAWSCARF_TEST_LITELLM !== "1",
    timeout: 60000,
  },
  async () => {
    const origin =
      process.env.CLAWSCARF_TEST_LITELLM_ORIGIN ?? "http://127.0.0.1:14000";
    const masterKeyFile = process.env.CLAWSCARF_TEST_LITELLM_MASTER_KEY_FILE;
    assert.ok(
      masterKeyFile,
      "Supply the isolated test gateway's administrator key file.",
    );
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-litellm-test-"));
    const keyFile = join(directory, "runtime-key");
    let calls = 0;
    const upstream = createServer((request, response) => {
      void (async () => {
        calls++;
        assert.equal(request.headers.authorization, "Bearer test-provider");
        const chunks: Buffer[] = [];
        for await (const chunk of request)
          chunks.push(
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
          );
        const body = Buffer.concat(chunks).toString("utf8");
        if (body.includes('"stream":true')) {
          response.setHeader("content-type", "text/event-stream");
          response.end(
            `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: { role: "assistant", content: "Streamed response" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
          );
          return;
        }
        if (body.includes('"content":"fail"')) {
          response.statusCode = 503;
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              error: {
                message: "Controlled upstream unavailable",
                type: "service_unavailable",
              },
            }),
          );
          return;
        }
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            created: 1,
            model: "test-model",
            choices: [
              {
                index: 0,
                message: body.includes('"tools"')
                  ? {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "call_test",
                          type: "function",
                          function: {
                            name: "echo",
                            arguments: '{"text":"hello"}',
                          },
                        },
                      ],
                    }
                  : {
                      role: "assistant",
                      content: "Controlled upstream response",
                    },
                finish_reason: body.includes('"tools"') ? "tool_calls" : "stop",
              },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
          }),
        );
      })().catch((error: unknown) =>
        response.destroy(
          error instanceof Error ? error : new Error("Upstream test failed"),
        ),
      );
    });
    upstream.listen(14001, "0.0.0.0");
    await once(upstream, "listening");
    try {
      await issueRuntimeCredential({
        origin,
        masterKeyFile,
        output: keyFile,
        configuration: configurationSchema.parse(
          JSON.parse(
            await readFile("deploy/models/config.example.json", "utf8"),
          ),
        ),
      });
      const key = (await readFile(keyFile, "utf8")).trim();
      const headers = {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      };
      assert.equal((await fetch(`${origin}/v1/models`)).status, 401);
      const models = await fetch(`${origin}/v1/models`, { headers });
      assert.equal(models.status, 200);
      assert.ok((await models.text()).includes("team-model"));
      const forbidden = await fetch(`${origin}/key/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ models: ["team-model"] }),
      });
      assert.ok([401, 403].includes(forbidden.status));
      const unknown = await fetch(`${origin}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "not-granted",
          messages: [{ role: "user", content: "hello" }],
        }),
      });
      assert.ok([400, 401, 403].includes(unknown.status));
      for (const tools of [
        undefined,
        [
          {
            type: "function",
            function: {
              name: "echo",
              parameters: {
                type: "object",
                properties: { text: { type: "string" } },
              },
            },
          },
        ],
      ]) {
        const response = await fetch(`${origin}/v1/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: "team-model",
            messages: [{ role: "user", content: "hello" }],
            tools,
          }),
          signal: AbortSignal.timeout(15000),
        });
        assert.equal(response.status, 200);
        assert.ok(
          (await response.text()).includes(
            tools ? "call_test" : "Controlled upstream response",
          ),
        );
      }
      const stream = await fetch(`${origin}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "team-model",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
        }),
      });
      assert.equal(stream.status, 200);
      const streamed = await stream.text();
      assert.ok(streamed.includes("Streamed response"));
      assert.ok(streamed.includes("[DONE]"));
      const failed = await fetch(`${origin}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "team-model",
          messages: [{ role: "user", content: "fail" }],
        }),
      });
      assert.equal(failed.status, 503);
      assert.equal(calls, 4);
      assert.equal(
        (
          await fetch(`${origin}/key/delete`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${(await readFile(masterKeyFile, "utf8")).trim()}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ keys: [key] }),
          })
        ).ok,
        true,
      );
      const revoked = await fetch(`${origin}/v1/models`, { headers });
      assert.ok([401, 403].includes(revoked.status));
    } finally {
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
    }
  },
);
