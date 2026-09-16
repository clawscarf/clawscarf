import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { Check } from "typebox/value";
import plugin from "../src/index.ts";
import { ConnectorFailure, type NativeCallContext } from "../src/broker.ts";
import {
  callParameters,
  configSchema,
  hasConnectionConfiguration,
  describeParameters,
  searchParameters,
} from "../src/schemas.ts";
import { createConnectorTool } from "../src/tools.ts";
import {
  invocationResult,
  descriptionResult,
  searchResult,
  MAX_TOOL_RESULT_BYTES,
  MAX_TOOL_DESCRIPTION_BYTES,
  MAX_TOOL_ARGUMENT_BYTES,
} from "../src/result.ts";
import type {
  ConnectionInvocation,
  ConnectorRuntimeInvocation,
  ConnectorRuntimeDescription,
  ConnectorRuntimeResultPage,
  ConnectorRuntimeSearchResult,
} from "../src/generated/types.gen.js";

const call = {
  mode: "execute" as const,
  connectionId: "connection-1",
  actionId: "ACTION",
  generation: 1,
  version: "20260901_01",
  arguments: { unexpectedProviderField: null },
};
const receipt: ConnectionInvocation = {
  id: "invocation-1",
  connectionId: "connection-1",
  generation: 1,
  agentId: "agent",
  actionId: "ACTION",
  version: "version-1",
  state: "succeeded",
  createdAt: "2026-09-10T00:00:00Z",
  completedAt: "2026-09-10T00:00:01Z",
  failure: null,
};

await test("the plugin declares exactly the three static tools and accepts native SecretRefs", () => {
  assert.deepEqual(
    getToolPluginMetadata(plugin)?.tools.map(({ name }) => name),
    ["connections_search", "connections_describe", "connections_call"],
  );
  assert.equal(Check(configSchema, {}), true);
  assert.equal(
    Check(configSchema, {
      credential: {
        source: "env",
        provider: "default",
        id: "CLAWSCARF_CONNECTIONS_TOKEN",
      },
    }),
    true,
  );
  assert.equal(
    Check(configSchema, {
      credential: { source: "invalid", provider: "default", id: "secret" },
    }),
    false,
  );
});

await test("native context is derived outside model arguments; unknown provider fields remain untouched", async () => {
  let observed: NativeCallContext | undefined;
  const controller = new AbortController();
  const tool = createConnectorTool({
    name: "connections_call",
    description: "Call",
    parameters: callParameters,
    toolContext: {
      agentId: "native-agent",
      sessionId: "session-1",
      sessionKey: "agent:native-agent:main",
      sandboxed: true,
    },
    requireSession: true,
    dispatches: (parameters) => parameters.mode === "execute",
    execute: (parameters, context) => {
      assert.deepEqual(parameters, call);
      observed = context;
      return Promise.resolve({
        state: "succeeded",
        data: { undocumented: null },
      });
    },
  });
  assert.deepEqual(
    (await tool.execute("tool-call-1", call, controller.signal)).details,
    {
      ok: true,
      data: { state: "succeeded", data: { undocumented: null } },
    },
  );
  assert.deepEqual(observed, {
    agentId: "native-agent",
    sessionId: "session-1",
    sessionKey: "agent:native-agent:main",
    toolCallId: "tool-call-1",
    signal: controller.signal,
  });
  observed = undefined;
  assert.deepEqual(
    (await tool.execute("tool-call-1", { ...call, agentId: "forged" })).details,
    {
      ok: false,
      error: {
        code: "invalid_arguments",
        message: "The connection tool arguments are invalid.",
      },
    },
  );
  assert.equal(observed, undefined);
});

await test("missing native identity/session, coerced input and advertised unsupported file options cannot dispatch", async () => {
  let calls = 0;
  const execute = () => {
    calls += 1;
    return Promise.resolve({});
  };
  for (const toolContext of [{}, { agentId: "agent" }]) {
    const tool = createConnectorTool({
      name: "connections_call",
      description: "Call",
      parameters: callParameters,
      toolContext,
      requireSession: true,
      execute,
    });
    const result = await tool.execute("call", call);
    assert.match(JSON.stringify(result.details), /native_context_unavailable/u);
  }
  const tool = createConnectorTool({
    name: "connections_call",
    description: "Call",
    parameters: callParameters,
    toolContext: { agentId: "agent", sessionId: "session" },
    execute,
  });
  for (const invalid of [
    { ...call, mode: undefined },
    { ...call, generation: "1" },
    { ...call, files: { path: "/etc/passwd" } },
    { ...call, arguments: { bad: Infinity } },
    { mode: "result", invocationId: "invocation-1", arguments: {} },
    { mode: "lookup", toolCallId: "original", agentId: "forged" },
    { mode: "lookup", toolCallId: "original", sessionKey: "forged" },
  ]) {
    assert.match(
      JSON.stringify((await tool.execute("call", invalid)).details),
      /invalid_arguments/u,
    );
  }
  assert.equal(calls, 0);
});

await test("result and lookup modes keep native context and report read failures without execution recovery", async () => {
  for (const parameters of [
    { mode: "result", invocationId: "invocation-1", cursor: "opaque" },
    { mode: "lookup", toolCallId: "original-call" },
  ]) {
    let calls = 0;
    const tool = createConnectorTool({
      name: "connections_call",
      description: "Read a saved result",
      parameters: callParameters,
      toolContext: { agentId: "agent", sessionId: "native-session" },
      requireSession: true,
      dispatches: (value) => value.mode === "execute",
      execute: (value, context) => {
        calls++;
        assert.deepEqual(value, parameters);
        assert.equal(context.agentId, "agent");
        assert.equal(context.sessionId, "native-session");
        assert.equal(context.toolCallId, "current-read-call");
        return Promise.reject(Error("sensitive transport detail"));
      },
    });
    assert.deepEqual(
      (await tool.execute("current-read-call", parameters)).details,
      {
        ok: false,
        error: {
          code: "broker_unavailable",
          message:
            "The connection result could not be read. No operation was dispatched by this read.",
        },
      },
    );
    assert.equal(calls, 1);
  }
});

await test("native search gives authorized setup guidance only when no connections are usable by this agent", async () => {
  let search: ConnectorRuntimeSearchResult = {
    items: [],
    nextCursor: null,
    guidance: {
      code: "no_usable_connections",
      connectionsUrl:
        "https://portal.example.test/app/organizations/org/installations/install/connections",
    },
  };
  const tool = createConnectorTool({
    name: "connections_search",
    description: "Search",
    parameters: searchParameters,
    toolContext: { agentId: "agent" },
    execute: () => Promise.resolve(search),
    render: searchResult,
  });
  const empty = await tool.execute("search", {});
  assert.deepEqual(empty.details, {
    ok: true,
    data: {
      ...search,
      message:
        "No connections are available to this agent. An installation administrator can connect an account or grant access on the Connections page.",
    },
  });
  assert.ok(
    JSON.stringify(empty.content).includes(search.guidance!.connectionsUrl),
  );
  search = { items: [], nextCursor: null, guidance: null };
  const filtered = await tool.execute("search", { query: "missing" });
  assert.deepEqual(filtered.details, {
    ok: true,
    data: {
      ...search,
      message:
        "No operations matched this search. Try a different search or remove filters.",
    },
  });
  assert.ok(!JSON.stringify(filtered).includes("connectionsUrl"));
});

await test("cancellation before dispatch is definitive; transport loss after dispatch is uncertain and never retried", async () => {
  let calls = 0;
  const controller = new AbortController();
  const tool = createConnectorTool({
    name: "connections_call",
    description: "Call",
    parameters: callParameters,
    toolContext: { agentId: "agent", sessionId: "session" },
    dispatches: (parameters) => parameters.mode === "execute",
    execute: () => {
      calls += 1;
      return Promise.reject(Error("sensitive upstream diagnostic"));
    },
  });
  controller.abort();
  assert.match(
    JSON.stringify(
      (await tool.execute("call", call, controller.signal)).details,
    ),
    /cancelled/u,
  );
  assert.equal(calls, 0);
  const unknown = await tool.execute("call", call);
  assert.match(JSON.stringify(unknown.details), /unknown_outcome/u);
  assert.doesNotMatch(JSON.stringify(unknown), /sensitive/u);
  assert.equal(calls, 1);
  assert.deepEqual(unknown.details, {
    ok: false,
    error: {
      code: "unknown_outcome",
      message:
        "The outcome could not be confirmed. Look up this call in the current session; do not repeat the operation.",
    },
    recovery: { mode: "lookup", toolCallId: "call" },
  });
});

await test("bounded failures preserve their code and large results do not become clipped successes", async () => {
  const tool = createConnectorTool({
    name: "connections_search",
    description: "Search",
    parameters: searchParameters,
    toolContext: { agentId: "agent" },
    execute: () => {
      return Promise.reject(
        new ConnectorFailure(
          "broker_unavailable",
          "Connections are unavailable.",
        ),
      );
    },
  });
  assert.match(
    JSON.stringify((await tool.execute("search", {})).details),
    /broker_unavailable/u,
  );
  const large = createConnectorTool({
    name: "connections_search",
    description: "Search",
    parameters: searchParameters,
    toolContext: { agentId: "agent" },
    execute: () => Promise.resolve({ data: "x".repeat(MAX_TOOL_RESULT_BYTES) }),
  });
  assert.deepEqual((await large.execute("large", {})).details, {
    ok: false,
    error: {
      code: "result_too_large",
      message: "The connection result exceeds the supported size.",
    },
  });
});

await test("oversized completed invocation output preserves success and its durable receipt", () => {
  const value: ConnectorRuntimeInvocation = {
    invocation: receipt,
    result: { kind: "inline", data: "x".repeat(MAX_TOOL_RESULT_BYTES) },
  };
  const rendered = invocationResult(value);
  assert.deepEqual(rendered.details, {
    ok: true,
    invocation: value.invocation,
    result: { kind: "unavailable", reason: "too_large" },
    message:
      "The complete result could not be delivered. Use result mode with the invocation reference to read saved data; do not execute the operation again.",
  });
});

await test("descriptions preserve large schemas verbatim and reject overflow without clipping", async () => {
  const description: ConnectorRuntimeDescription = {
    connectionId: "connection-1",
    generation: 1,
    action: {
      id: "ACTION",
      connectorId: "service",
      name: "Action",
      description: "Large advisory schema",
      version: "version-1",
      schemaDigest: "a".repeat(64),
      inputSchema: { description: "\u2603".repeat(25_000) },
      outputSchema: { additionalProperties: true },
      fileInputs: [],
      fileOutputs: [],
    },
  };
  const tool = createConnectorTool({
    name: "connections_describe",
    description: "Describe",
    parameters: describeParameters,
    toolContext: { agentId: "agent" },
    execute: () => Promise.resolve(description),
    render: descriptionResult,
  });
  const args = { connectionId: "connection-1", actionId: "ACTION" };
  const result = await tool.execute("describe", args);
  assert.deepEqual(result.details, { ok: true, data: description });
  const text = result.content[0];
  assert.ok(text?.type === "text");
  assert.ok(Buffer.byteLength(text.text) > MAX_TOOL_RESULT_BYTES);
  assert.deepEqual(JSON.parse(text.text), result.details);
  description.action.inputSchema = {
    description: "x".repeat(MAX_TOOL_DESCRIPTION_BYTES),
  };
  assert.deepEqual((await tool.execute("overflow", args)).details, {
    ok: false,
    error: {
      code: "result_too_large",
      message: "The connection result exceeds the supported size.",
    },
  });
});

await test("saved result pages fit the tool envelope and expiry preserves successful execution", () => {
  const text = "\u0000".repeat(8192);
  const page: ConnectorRuntimeResultPage = {
    invocation: receipt,
    result: {
      kind: "page",
      reference: {
        kind: "reference",
        invocationId: receipt.id,
        mediaType: "application/json",
        byteLength: 100_000,
        sha256: "a".repeat(64),
        expiresAt: "2026-09-11T00:00:01Z",
      },
      text,
      offsetBytes: 8192,
      nextCursor: "opaque-page-cursor",
    },
  };
  const rendered = invocationResult(page);
  assert.deepEqual(rendered.details, { ok: true, ...page });
  for (const content of rendered.content) {
    assert.equal(content.type, "text");
    if (content.type !== "text") assert.fail("Expected text result.");
    assert.ok(Buffer.byteLength(content.text) <= MAX_TOOL_RESULT_BYTES);
  }
  const expired: ConnectorRuntimeResultPage = {
    invocation: receipt,
    result: { kind: "unavailable", reason: "expired" },
  };
  assert.deepEqual(invocationResult(expired).details, {
    ok: true,
    ...expired,
  });
});

await test("call arguments receive their full JSON budget independently of the request envelope", async () => {
  let calls = 0;
  const tool = createConnectorTool({
    name: "connections_call",
    description: "Call",
    parameters: callParameters,
    toolContext: { agentId: "agent", sessionId: "session" },
    requireSession: true,
    execute: () => {
      calls += 1;
      return Promise.resolve({});
    },
  });
  const overhead = Buffer.byteLength(JSON.stringify({ text: "" }));
  const argumentsValue = {
    text: "x".repeat(MAX_TOOL_ARGUMENT_BYTES - overhead),
  };
  const result = await tool.execute("call", {
    ...call,
    arguments: argumentsValue,
  });
  assert.deepEqual(result.details, { ok: true, data: {} });
  assert.equal(calls, 1);
  const rejected = await tool.execute("call2", {
    ...call,
    arguments: { text: argumentsValue.text + "x" },
  });
  assert.match(JSON.stringify(rejected.details), /invalid_arguments/u);
  assert.equal(calls, 1);
});

await test("unconfigured tools are disabled and partial or unsafe configuration fails visibly", () => {
  assert.equal(hasConnectionConfiguration({}), false);
  assert.equal(
    hasConnectionConfiguration({
      brokerUrl: "https://broker.example.test",
      credential: "test",
    }),
    true,
  );
  assert.equal(
    hasConnectionConfiguration({
      brokerUrl: "http://127.0.0.1:8000",
      credential: "test",
    }),
    true,
  );
  assert.throws(() => hasConnectionConfiguration({ credential: "test" }));
  assert.throws(() =>
    hasConnectionConfiguration({ brokerUrl: "https://broker.example.test" }),
  );
  assert.throws(() =>
    hasConnectionConfiguration({
      brokerUrl: "http://broker.example.test",
      credential: "test",
    }),
  );
  assert.throws(() =>
    hasConnectionConfiguration({
      brokerUrl: "https://user:secret@broker.example.test",
      credential: "test",
    }),
  );
});

await test("the native manifest and runtime configuration schema have one shape", async () => {
  const manifest: unknown = JSON.parse(
    await readFile(new URL("../openclaw.plugin.json", import.meta.url), "utf8"),
  );
  assert.ok(
    manifest && typeof manifest === "object" && "configSchema" in manifest,
  );
  assert.deepEqual(
    manifest.configSchema,
    JSON.parse(JSON.stringify(configSchema)),
  );
});
