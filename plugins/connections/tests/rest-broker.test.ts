import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createRestBroker } from "../src/rest-broker.ts";
import { MAX_TOOL_REQUEST_BYTES } from "../src/result.ts";
import { ConnectorFailure } from "../src/broker.ts";
import type { ConnectorRuntimeInvocation } from "../src/generated/types.gen.js";

await test("tool execution receives a slow result and still honors native cancellation without replay", async () => {
  const receipt: ConnectorRuntimeInvocation = {
    invocation: {
      id: "slow-invocation",
      connectionId: "connection-1",
      generation: 1,
      agentId: "agent-1",
      actionId: "ACTION",
      version: "version-1",
      state: "succeeded",
      createdAt: "2026-09-10T00:00:00Z",
      completedAt: "2026-09-10T00:00:16Z",
      failure: null,
    },
    result: { kind: "inline", data: { delivered: true } },
  };
  let requests = 0;
  const secondRequest = Promise.withResolvers<void>();
  const server = createServer((request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/connector-runtime/call");
    request.resume();
    requests++;
    if (requests === 2) secondRequest.resolve();
    const timer = setTimeout(() => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(receipt));
    }, 16_000);
    response.once("close", () => clearTimeout(timer));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const broker = createRestBroker({
    brokerUrl: `http://127.0.0.1:${address.port}`,
    credential: "scoped-installation-token",
  });
  const parameters = {
    mode: "execute" as const,
    connectionId: "connection-1",
    generation: 1,
    actionId: "ACTION",
    version: "version-1",
    arguments: {},
  };
  const context = { agentId: "agent-1", sessionId: "session-1" };
  try {
    assert.deepEqual(
      await broker.call(parameters, { ...context, toolCallId: "slow-call" }),
      receipt,
    );
    const cancellation = new AbortController();
    const cancelled = assert.rejects(
      broker.call(parameters, {
        ...context,
        toolCallId: "cancelled-call",
        signal: cancellation.signal,
      }),
      (error: unknown) =>
        error instanceof ConnectorFailure && error.code === "unknown_outcome",
    );
    await secondRequest.promise;
    cancellation.abort();
    await cancelled;
    assert.equal(requests, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

await test("generated broker client sends only scoped credentials and native context without provider schema coercion", async () => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    assert.equal(
      request.headers.authorization,
      "Bearer scoped-installation-token",
    );
    assert.equal(request.url, "/connector-runtime/call");
    let body = "";
    request.setEncoding("utf8").on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed: unknown = JSON.parse(body);
      assert.deepEqual(parsed, {
        connectionId: "connection-1",
        generation: 2,
        actionId: "ACTION",
        version: "version-1",
        arguments: { unexpected: null },
        context: {
          agentId: "agent-1",
          sessionKey: "agent:agent-1:main",
          toolCallId: "call-1",
        },
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          invocation: {
            id: "invocation-1",
            connectionId: "connection-1",
            generation: 2,
            agentId: "agent-1",
            actionId: "ACTION",
            version: "version-1",
            state: "succeeded",
            createdAt: "2026-09-10T00:00:00Z",
            completedAt: "2026-09-10T00:00:01Z",
            failure: null,
          },
          result: {
            kind: "inline",
            data: { missingFromAdvertisedSchema: null },
          },
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const broker = createRestBroker({
      brokerUrl: `http://127.0.0.1:${address.port}`,
      credential: "scoped-installation-token",
    });
    const result = await broker.call(
      {
        mode: "execute",
        connectionId: "connection-1",
        generation: 2,
        actionId: "ACTION",
        version: "version-1",
        arguments: { unexpected: null },
      },
      {
        agentId: "agent-1",
        sessionKey: "agent:agent-1:main",
        toolCallId: "call-1",
      },
    );
    assert.equal(result.invocation.state, "succeeded");
    assert.deepEqual(result.result, {
      kind: "inline",
      data: { missingFromAdvertisedSchema: null },
    });
    await assert.rejects(
      broker.call(
        {
          mode: "execute",
          connectionId: "connection-1",
          generation: 2,
          actionId: "ACTION",
          version: "version-1",
          arguments: {},
        },
        {
          agentId: "agent-1",
          sessionKey: "x".repeat(MAX_TOOL_REQUEST_BYTES),
          toolCallId: "call-2",
        },
      ),
      (error: unknown) =>
        error instanceof ConnectorFailure && error.code === "invalid_arguments",
    );
    assert.equal(requests, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

await test("unconfigured or unresolved credentials do not create an unauthenticated request", async () => {
  for (const config of [
    {},
    {
      brokerUrl: "https://example.invalid",
      credential: { source: "env" as const, provider: "default", id: "SECRET" },
    },
    { brokerUrl: "http://untrusted.example", credential: "secret" },
  ]) {
    const broker = createRestBroker(config);
    await assert.rejects(
      broker.search({}, { agentId: "agent", toolCallId: "search" }),
      (error: unknown) =>
        error instanceof ConnectorFailure &&
        error.code === "broker_unavailable",
    );
  }
});

await test("generated result paging and session lookup never replay execution, including after a lost response", async () => {
  const serialized = JSON.stringify({ text: '😀\n"'.repeat(20_000) });
  const pages: { text: string; offsetBytes: number }[] = [];
  let text = "";
  let bytes = 0;
  let offsetBytes = 0;
  for (const character of serialized) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 8192) {
      pages.push({ text, offsetBytes });
      offsetBytes += bytes;
      text = "";
      bytes = 0;
    }
    text += character;
    bytes += size;
  }
  pages.push({ text, offsetBytes });
  const receipts = new Map<string, ConnectorRuntimeInvocation>();
  let executions = 0;
  let expired = false;
  const requests: {
    method: string | undefined;
    path: string;
    body: unknown;
  }[] = [];
  const server = createServer((request, response) => {
    assert.equal(
      request.headers.authorization === "Bearer scoped-installation-token",
      true,
    );
    let body = "";
    request.setEncoding("utf8").on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed: unknown = body ? JSON.parse(body) : null;
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      requests.push({
        method: request.method,
        path: url.pathname,
        body: parsed,
      });
      const send = (value: unknown) => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (url.pathname === "/connector-runtime/call") {
        assert.equal(request.method, "POST");
        assert.ok(parsed && typeof parsed === "object" && "context" in parsed);
        assert.ok(!("mode" in parsed));
        const context = parsed.context;
        assert.ok(
          context && typeof context === "object" && "toolCallId" in context,
        );
        assert.equal("agentId" in context && context.agentId, "agent-1");
        assert.equal(
          "sessionKey" in context && context.sessionKey,
          "agent:agent-1:main",
        );
        assert.equal(typeof context.toolCallId, "string");
        if (typeof context.toolCallId !== "string")
          assert.fail("Missing native call ID.");
        executions++;
        const id = `invocation-${executions}`;
        const receipt: ConnectorRuntimeInvocation = {
          invocation: {
            id,
            connectionId: "connection-1",
            generation: 2,
            agentId: "agent-1",
            actionId: "ACTION",
            version: "version-1",
            state: "succeeded",
            createdAt: "2026-09-10T00:00:00Z",
            completedAt: "2026-09-10T00:00:01Z",
            failure: null,
          },
          result: {
            kind: "reference",
            invocationId: id,
            mediaType: "application/json",
            byteLength: Buffer.byteLength(serialized),
            sha256: createHash("sha256").update(serialized).digest("hex"),
            expiresAt: "2026-09-11T00:00:01Z",
          },
        };
        receipts.set(context.toolCallId, receipt);
        if (context.toolCallId === "lost-write") request.socket.destroy();
        else send(receipt);
        return;
      }
      if (url.pathname === "/connector-runtime/invocations/lookup") {
        assert.equal(request.method, "POST");
        assert.ok(parsed && typeof parsed === "object" && "context" in parsed);
        assert.deepEqual(parsed.context, {
          agentId: "agent-1",
          sessionKey: "agent:agent-1:main",
          toolCallId: "lookup-call",
        });
        assert.ok(
          "targetToolCallId" in parsed &&
            typeof parsed.targetToolCallId === "string",
        );
        const receipt = receipts.get(parsed.targetToolCallId);
        if (receipt) send(receipt);
        else
          response
            .writeHead(404, { "Content-Type": "application/json" })
            .end("{}");
        return;
      }
      assert.equal(request.method, "GET");
      assert.equal(
        url.pathname,
        "/connector-runtime/invocations/invocation-1/result",
      );
      assert.equal(url.searchParams.get("agentId"), "agent-1");
      assert.equal(parsed, null);
      if (url.searchParams.get("cursor") === "denied") {
        response
          .writeHead(403, { "Content-Type": "application/json" })
          .end("{}");
        return;
      }
      if (url.searchParams.get("cursor") === "lost-read") {
        request.socket.destroy();
        return;
      }
      const receipt = receipts.get("execute-call");
      assert.ok(receipt && receipt.result.kind === "reference");
      if (expired) {
        send({
          invocation: receipt.invocation,
          result: { kind: "unavailable", reason: "expired" },
        });
        return;
      }
      const pageIndex = Number(url.searchParams.get("cursor") ?? 0);
      const page = pages[pageIndex];
      assert.ok(page);
      send({
        invocation: receipt.invocation,
        result: {
          kind: "page",
          reference: receipt.result,
          ...page,
          nextCursor:
            pageIndex + 1 < pages.length ? String(pageIndex + 1) : null,
        },
      });
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const broker = createRestBroker({
    brokerUrl: `http://127.0.0.1:${address.port}`,
    credential: "scoped-installation-token",
  });
  const context = {
    agentId: "agent-1",
    sessionKey: "agent:agent-1:main",
    toolCallId: "execute-call",
  };
  const execution = {
    mode: "execute" as const,
    connectionId: "connection-1",
    generation: 2,
    actionId: "ACTION",
    version: "version-1",
    arguments: {},
  };
  try {
    const executed = await broker.call(execution, context);
    assert.equal(executed.result.kind, "reference");
    let cursor: string | undefined;
    let restored = "";
    do {
      const page = await broker.call(
        {
          mode: "result",
          invocationId: "invocation-1",
          ...(cursor ? { cursor } : {}),
        },
        { ...context, toolCallId: "read-call" },
      );
      assert.equal(page.invocation.state, "succeeded");
      if (page.result.kind !== "page")
        assert.fail("Expected a saved result page.");
      assert.equal(page.result.offsetBytes, Buffer.byteLength(restored));
      assert.ok(Buffer.byteLength(page.result.text) <= 8192);
      restored += page.result.text;
      cursor = page.result.nextCursor ?? undefined;
      assert.equal(
        createHash("sha256").update(serialized).digest("hex"),
        page.result.reference.sha256,
      );
    } while (cursor);
    assert.equal(restored, serialized);
    assert.equal(executions, 1);
    expired = true;
    const expiry = await broker.call(
      { mode: "result", invocationId: "invocation-1" },
      context,
    );
    assert.equal(expiry.invocation.state, "succeeded");
    assert.deepEqual(expiry.result, { kind: "unavailable", reason: "expired" });
    const before = requests.length;
    await assert.rejects(
      broker.call(execution, { ...context, toolCallId: "lost-write" }),
      (error: unknown) =>
        error instanceof ConnectorFailure && error.code === "unknown_outcome",
    );
    assert.equal(requests.length, before + 1);
    assert.equal(executions, 2);
    const recovered = await broker.call(
      { mode: "lookup", toolCallId: "lost-write" },
      { ...context, toolCallId: "lookup-call" },
    );
    assert.equal(recovered.invocation.id, "invocation-2");
    assert.equal(recovered.invocation.state, "succeeded");
    assert.equal(executions, 2);
    for (const [cursor, code] of [
      ["denied", "access_denied"],
      ["lost-read", "broker_unavailable"],
    ] as const) {
      await assert.rejects(
        broker.call(
          { mode: "result", invocationId: "invocation-1", cursor },
          context,
        ),
        (error: unknown) =>
          error instanceof ConnectorFailure && error.code === code,
      );
    }
    await assert.rejects(
      broker.call(
        { mode: "lookup", toolCallId: "missing" },
        { ...context, toolCallId: "lookup-call" },
      ),
      (error: unknown) =>
        error instanceof ConnectorFailure && error.code === "receipt_not_found",
    );
    assert.equal(executions, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
