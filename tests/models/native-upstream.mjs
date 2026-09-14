import console from "node:console";
import { createServer } from "node:http";
const server = createServer((req, res) => {
  void (async () => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    const tools = (input.tools ?? []).map((t) => t.function?.name);
    const done = input.messages.some((m) => m.role === "tool");
    if (
      done &&
      !input.messages.some(
        (m) =>
          m.role === "tool" &&
          JSON.stringify(m.content).includes("controlled native tool result"),
      )
    )
      throw Error("Native tool result missing");
    console.log(
      JSON.stringify({
        request: done ? "after-tool" : "first",
        model: input.model,
        tools,
        stream: input.stream,
      }),
    );
    const message = done
      ? { role: "assistant", content: "Native model and read tool verified." }
      : {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_native_read",
              type: "function",
              function: {
                name: "read",
                arguments: JSON.stringify({
                  path: "/home/node/model-proof.txt",
                }),
              },
            },
          ],
        };
    if (input.stream) {
      res.setHeader("content-type", "text/event-stream");
      res.end(
        `data: ${JSON.stringify({ id: "chatcmpl-proof", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: done ? message : { role: "assistant", tool_calls: message.tool_calls.map((v, i) => ({ ...v, index: i })) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "chatcmpl-proof", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: done ? "stop" : "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`,
      );
    } else {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "chatcmpl-proof",
          object: "chat.completion",
          created: 1,
          model: "test-model",
          choices: [
            { index: 0, message, finish_reason: done ? "stop" : "tool_calls" },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    }
  })().catch(() => {
    res.statusCode = 500;
    res.end();
  });
});
server.listen(14001, "0.0.0.0", () => console.log("Controlled upstream ready"));
