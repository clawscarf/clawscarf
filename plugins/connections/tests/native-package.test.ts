import assert from "node:assert/strict";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";
import type {
  ConnectorRuntimeContext,
  ConnectorRuntimeDescription,
  ConnectorRuntimeInvocation,
  ConnectorRuntimeSearchResult,
} from "../src/generated/types.gen.js";

const execute = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "..");
const runtime = resolve(packageRoot, "node_modules/openclaw/openclaw.mjs");

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

function nativeContext(body: unknown): ConnectorRuntimeContext {
  assert.ok(body && typeof body === "object" && "context" in body);
  const context = body.context;
  assert.ok(context && typeof context === "object");
  assert.ok("agentId" in context && typeof context.agentId === "string");
  assert.ok("toolCallId" in context && typeof context.toolCallId === "string");
  return {
    agentId: context.agentId,
    toolCallId: context.toolCallId,
    ...("sessionId" in context && typeof context.sessionId === "string"
      ? { sessionId: context.sessionId }
      : {}),
    ...("sessionKey" in context && typeof context.sessionKey === "string"
      ? { sessionKey: context.sessionKey }
      : {}),
  };
}

await test(
  "packed plugin installs with native consent, starts without broker/models, survives restart and respects disablement",
  { timeout: 180_000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "clawscarf-connections-package-"),
    );
    const state = join(directory, "state");
    const home = join(directory, "home");
    const configPath = join(directory, "openclaw.json");
    const port = await freePort();
    const brokerPort = await freePort();
    const connectionsUrl =
      "https://portal.example.test/app/organizations/11111111-1111-4111-8111-111111111111/installations/22222222-2222-4222-8222-222222222222/connections";
    const noConnections: ConnectorRuntimeSearchResult = {
      items: [],
      nextCursor: null,
      guidance: { code: "no_usable_connections", connectionsUrl },
    };
    const noMatches: ConnectorRuntimeSearchResult = {
      items: [],
      nextCursor: null,
      guidance: null,
    };
    const description: ConnectorRuntimeDescription = {
      connectionId: "44444444-4444-4444-8444-444444444444",
      generation: 1,
      action: {
        id: "ACTION",
        connectorId: "service",
        name: "Action",
        description: "An operation with a large advisory schema.",
        version: "version-1",
        schemaDigest: "a".repeat(64),
        inputSchema: { description: "Schema guidance. ".repeat(4600) },
        outputSchema: { type: "object", additionalProperties: true },
        fileInputs: [],
        fileOutputs: [],
      },
    };
    const savedJson = JSON.stringify({ text: "stored result ".repeat(6000) });
    const invocationId = "33333333-3333-4333-8333-333333333333";
    const resultReference = {
      kind: "reference" as const,
      invocationId,
      mediaType: "application/json" as const,
      byteLength: Buffer.byteLength(savedJson),
      sha256: createHash("sha256").update(savedJson).digest("hex"),
      expiresAt: "2026-09-11T00:00:01Z",
    };
    const savedInvocation: ConnectorRuntimeInvocation = {
      invocation: {
        id: invocationId,
        connectionId: "44444444-4444-4444-8444-444444444444",
        generation: 1,
        agentId: "main",
        actionId: "ACTION",
        version: "version-1",
        state: "succeeded",
        createdAt: "2026-09-10T00:00:00Z",
        completedAt: "2026-09-10T00:00:01Z",
        failure: null,
      },
      result: resultReference,
    };
    let executionContext: ConnectorRuntimeContext | undefined;
    let executions = 0;
    let brokerResult = noConnections;
    const brokerRequests: {
      method: string | undefined;
      path: string | undefined;
      authenticated: boolean;
      body: unknown;
    }[] = [];
    const broker = createHttpServer((request, response) => {
      let body = "";
      request.setEncoding("utf8").on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        let parsed: unknown;
        try {
          parsed = body ? JSON.parse(body) : null;
        } catch {
          response.writeHead(400).end();
          return;
        }
        brokerRequests.push({
          method: request.method,
          path: request.url,
          authenticated:
            request.headers.authorization ===
            "Bearer synthetic-installation-credential",
          body: parsed,
        });
        const send = (value: unknown) => {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify(value));
        };
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname === "/v1/connector-runtime/search") {
          send(brokerResult);
          return;
        }
        if (url.pathname === "/v1/connector-runtime/describe") {
          send(description);
          return;
        }
        if (url.pathname === "/v1/connector-runtime/call") {
          executions++;
          executionContext = nativeContext(parsed);
          assert.equal(executionContext.agentId, "main");
          request.socket.destroy();
          return;
        }
        assert.ok(executionContext);
        if (url.pathname === "/v1/connector-runtime/invocations/lookup") {
          const context = nativeContext(parsed);
          assert.equal(context.agentId, executionContext.agentId);
          assert.equal(context.sessionId, executionContext.sessionId);
          assert.equal(context.sessionKey, executionContext.sessionKey);
          assert.ok(
            parsed &&
              typeof parsed === "object" &&
              "targetToolCallId" in parsed,
          );
          assert.equal(parsed.targetToolCallId, executionContext.toolCallId);
          assert.notEqual(context.toolCallId, executionContext.toolCallId);
          send(savedInvocation);
          return;
        }
        assert.equal(
          url.pathname,
          `/v1/connector-runtime/invocations/${invocationId}/result`,
        );
        assert.equal(request.method, "GET");
        assert.equal(url.searchParams.get("agentId"), "main");
        const offsetBytes = Number(url.searchParams.get("cursor") ?? 0);
        const text = savedJson.slice(offsetBytes, offsetBytes + 8192);
        const nextOffset = offsetBytes + text.length;
        send({
          invocation: savedInvocation.invocation,
          result: {
            kind: "page",
            reference: resultReference,
            text,
            offsetBytes,
            nextCursor:
              nextOffset < savedJson.length ? String(nextOffset) : null,
          },
        });
      });
    });
    const stopBroker = async () => {
      if (!broker.listening) return;
      broker.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        broker.close((error) => (error ? reject(error) : resolve())),
      );
    };
    await mkdir(home);
    const env = {
      HOME: home,
      PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      OPENCLAW_STATE_DIR: state,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_DISABLE_BONJOUR: "1",
      OPENCLAW_EXEC_SHELL_SNAPSHOT: "0",
      OPENCLAW_NO_RESPAWN: "1",
      CLAWSCARF_CONNECTIONS_TEST_SECRET: "synthetic-installation-credential",
    };
    const native = async (...args: string[]) =>
      execute(process.execPath, [runtime, ...args], {
        cwd: directory,
        env,
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
      });
    const token = "synthetic-gateway-qualification-token";
    await writeFile(
      configPath,
      JSON.stringify({
        gateway: {
          mode: "local",
          bind: "loopback",
          port,
          auth: { mode: "token", token },
        },
        agents: {
          defaults: { workspace: join(directory, "workspace") },
          entries: { main: { default: true } },
        },
        plugins: {
          entries: {
            "clawscarf-connections": {
              enabled: true,
              config: {
                brokerUrl: `http://127.0.0.1:${brokerPort}`,
                credential: {
                  source: "env",
                  provider: "default",
                  id: "CLAWSCARF_CONNECTIONS_TEST_SECRET",
                },
              },
            },
          },
        },
        tools: { allow: ["clawscarf-connections"] },
      }),
    );

    let gateway: ChildProcess | undefined;
    let diagnostics = "";
    const stop = async () => {
      if (!gateway || gateway.exitCode !== null) return;
      const stopped = once(gateway, "exit");
      gateway.kill("SIGTERM");
      await stopped;
    };
    const start = async () => {
      diagnostics = "";
      gateway = spawn(process.execPath, [runtime, "gateway", "run"], {
        cwd: directory,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      for (const stream of [gateway.stdout, gateway.stderr]) {
        stream?.setEncoding("utf8").on("data", (chunk: string) => {
          diagnostics = (diagnostics + chunk).slice(-12_000);
        });
      }
      for (let i = 0; i < 120; i += 1) {
        if (gateway.exitCode !== null)
          throw new Error(`Gateway exited before readiness: ${diagnostics}`);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok) return;
        } catch {
          // Connection refusal is expected before the isolated Gateway binds its port.
        }
        await delay(250);
      }
      throw new Error(`Gateway readiness timed out: ${diagnostics}`);
    };
    let invocationCount = 0;
    const invoke = async (tool: string, args: unknown = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}/tools/invoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tool,
          args,
          agentId: "main",
          idempotencyKey: `package-proof-${++invocationCount}`,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      return { status: response.status, body: await response.text() };
    };
    const toolResult = (response: { status: number; body: string }) => {
      assert.equal(response.status, 200, response.body);
      assert.doesNotMatch(response.body, /synthetic-installation-credential/u);
      const parsed: unknown = JSON.parse(response.body);
      assert.ok(parsed && typeof parsed === "object" && "result" in parsed);
      assert.ok(
        parsed.result &&
          typeof parsed.result === "object" &&
          "details" in parsed.result,
      );
      return parsed.result;
    };
    const toolDetails = (response: { status: number; body: string }) =>
      toolResult(response).details;
    const verifySearch = (
      response: { status: number; body: string },
      expected: ConnectorRuntimeSearchResult,
    ) => {
      assert.deepEqual(toolDetails(response), {
        ok: true,
        data: {
          ...expected,
          message: expected.guidance
            ? "No connections are available to this agent. An installation administrator can connect an account or grant access on the Connections page."
            : "No operations matched this search. Try a different search or remove filters.",
        },
      });
      if (expected.guidance) assert.ok(response.body.includes(connectionsUrl));
      else assert.doesNotMatch(response.body, /connectionsUrl|administrator/u);
    };
    try {
      const pack = await execute(
        "npm",
        ["pack", "--json", "--pack-destination", directory],
        { cwd: packageRoot, env, maxBuffer: 1024 * 1024 },
      );
      const packed: unknown = JSON.parse(pack.stdout);
      assert.ok(Array.isArray(packed));
      const first: unknown = packed[0];
      assert.ok(
        first &&
          typeof first === "object" &&
          "filename" in first &&
          typeof first.filename === "string",
      );
      const { stdout: listing } = await execute("tar", [
        "-tzf",
        join(directory, first.filename),
      ]);
      assert.ok(
        listing.includes("package/dist/generated/http/client/index.js"),
      );
      assert.ok(listing.includes("package/dist/generated/http/LICENSE.md"));
      assert.ok(!listing.includes("package/dist/generated/client/"));
      const locator = `npm-pack:${join(directory, first.filename)}`;
      // The authored plugin config is invalid until the manifest is installed. The CLI
      // reads it while planning installation, so seed it only after the actual install.
      const configured = await readFile(configPath, "utf8");
      await writeFile(
        configPath,
        JSON.stringify({
          gateway: {
            mode: "local",
            bind: "loopback",
            port,
            auth: { mode: "token", token },
          },
        }),
      );
      await assert.rejects(native("plugins", "install", locator, "--force"), {
        code: 1,
      });
      await native(
        "plugins",
        "install",
        locator,
        "--force",
        "--accept-capabilities",
      );
      const installed: unknown = JSON.parse(await readFile(configPath, "utf8"));
      const desired: unknown = JSON.parse(configured);
      assert.ok(
        installed && typeof installed === "object" && "plugins" in installed,
      );
      assert.ok(desired && typeof desired === "object" && "plugins" in desired);
      assert.ok(installed.plugins && typeof installed.plugins === "object");
      assert.ok(desired.plugins && typeof desired.plugins === "object");
      await writeFile(
        configPath,
        JSON.stringify({
          ...desired,
          plugins: { ...installed.plugins, ...desired.plugins },
        }),
      );
      const inspection = await native(
        "plugins",
        "inspect",
        "clawscarf-connections",
        "--runtime",
        "--json",
      );
      assert.deepEqual(
        [
          ...new Set(inspection.stdout.match(/\bconnections_[a-z_]+\b/gu)),
        ].sort(),
        ["connections_call", "connections_describe", "connections_search"],
      );
      const skills = await native("skills", "list", "--json");
      assert.match(skills.stdout, /Discover and use the accounts connected/u);
      await start();
      const firstCall = await invoke("connections_search");
      assert.equal(firstCall.status, 200, firstCall.body);
      assert.match(firstCall.body, /broker_unavailable/u);
      assert.doesNotMatch(firstCall.body, /synthetic-installation-credential/u);
      broker.listen(brokerPort, "127.0.0.1");
      await once(broker, "listening");
      verifySearch(await invoke("connections_search"), noConnections);
      const described = toolResult(
        await invoke("connections_describe", {
          connectionId: description.connectionId,
          actionId: description.action.id,
        }),
      );
      assert.deepEqual(described.details, { ok: true, data: description });
      assert.ok("content" in described && Array.isArray(described.content));
      assert.equal(described.content.length, 1);
      const text: unknown = described.content[0];
      assert.ok(text && typeof text === "object" && "text" in text);
      assert.equal(typeof text.text, "string");
      assert.equal(text.text, JSON.stringify(described.details));
      brokerResult = noMatches;
      verifySearch(
        await invoke("connections_search", { query: "does-not-exist" }),
        noMatches,
      );
      const lost = toolDetails(
        await invoke("connections_call", {
          mode: "execute",
          connectionId: savedInvocation.invocation.connectionId,
          actionId: "ACTION",
          generation: 1,
          version: "version-1",
          arguments: {},
        }),
      );
      assert.ok(executionContext);
      assert.deepEqual(lost, {
        ok: false,
        error: {
          code: "unknown_outcome",
          message:
            "The outcome could not be confirmed. Look up this call in the current session; do not repeat the operation.",
        },
        recovery: { mode: "lookup", toolCallId: executionContext.toolCallId },
      });
      const lookup = async () => {
        assert.ok(executionContext);
        assert.deepEqual(
          toolDetails(
            await invoke("connections_call", {
              mode: "lookup",
              toolCallId: executionContext.toolCallId,
            }),
          ),
          { ok: true, ...savedInvocation },
        );
      };
      const readPage = async (offsetBytes: number) => {
        const text = savedJson.slice(offsetBytes, offsetBytes + 8192);
        const nextOffset = offsetBytes + text.length;
        assert.deepEqual(
          toolDetails(
            await invoke("connections_call", {
              mode: "result",
              invocationId,
              ...(offsetBytes ? { cursor: String(offsetBytes) } : {}),
            }),
          ),
          {
            ok: true,
            invocation: savedInvocation.invocation,
            result: {
              kind: "page",
              reference: resultReference,
              text,
              offsetBytes,
              nextCursor:
                nextOffset < savedJson.length ? String(nextOffset) : null,
            },
          },
        );
        return text;
      };
      await lookup();
      let restored = await readPage(0);
      await stop();
      await start();
      brokerResult = noConnections;
      verifySearch(await invoke("connections_search"), noConnections);
      brokerResult = noMatches;
      verifySearch(
        await invoke("connections_search", { query: "does-not-exist" }),
        noMatches,
      );
      await lookup();
      while (restored.length < savedJson.length)
        restored += await readPage(restored.length);
      assert.equal(restored, savedJson);
      assert.equal(
        createHash("sha256").update(restored).digest("hex"),
        resultReference.sha256,
      );
      assert.equal(executions, 1);
      assert.ok(brokerRequests.every((request) => request.authenticated));
      const searches = brokerRequests.filter(
        (request) => request.path === "/v1/connector-runtime/search",
      );
      assert.equal(searches.length, 4);
      const callIds = new Set<string>();
      for (const [index, request] of searches.entries()) {
        assert.equal(request.method, "POST");
        assert.equal(request.path, "/v1/connector-runtime/search");
        assert.equal(request.authenticated, true);
        assert.ok(
          request.body &&
            typeof request.body === "object" &&
            "context" in request.body,
        );
        const { context, ...parameters } = request.body;
        assert.deepEqual(
          parameters,
          index % 2 === 0 ? {} : { query: "does-not-exist" },
        );
        assert.ok(
          context && typeof context === "object" && "agentId" in context,
        );
        assert.equal(context.agentId, "main");
        assert.ok(
          "toolCallId" in context && typeof context.toolCallId === "string",
        );
        callIds.add(context.toolCallId);
      }
      assert.equal(callIds.size, 4);
      await stop();
      await stopBroker();
      await native(
        "plugins",
        "install",
        "--link",
        packageRoot,
        "--force",
        "--accept-capabilities",
      );
      await start();
      const linkedCall = await invoke("connections_call", {
        mode: "execute",
        connectionId: "connection-1",
        actionId: "ACTION",
        generation: 1,
        version: "version-1",
        arguments: {},
      });
      assert.equal(linkedCall.status, 200, linkedCall.body);
      assert.match(linkedCall.body, /unknown_outcome/u);
      await stop();
      await native("plugins", "disable", "clawscarf-connections");
      await native(
        "plugins",
        "install",
        "--link",
        packageRoot,
        "--force",
        "--accept-capabilities",
      );
      await start();
      const disabled = await invoke("connections_search");
      assert.equal(disabled.status, 404, disabled.body);
    } finally {
      await stop();
      await stopBroker();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
