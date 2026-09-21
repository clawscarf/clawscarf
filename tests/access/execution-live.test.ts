import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GatewayClient } from "@openclaw/gateway-client";
import { z } from "zod";
import { readConfiguration } from "../../services/access/runtime/config.js";
import { composeAccess } from "../../services/access/runtime/composition.js";
import { EnrollmentService } from "../../services/access/service/enrollment.js";
import { hash, token } from "../../services/access/service/session.js";
import { isAccessDenied } from "../../services/access/providers/gateway.js";
import { readState } from "../../scripts/deployment/state.js";
import { verifyRuntimeBinding } from "../../scripts/deployment/runtime-binding.js";
import { run } from "../../scripts/deployment/process.js";

const configPath = process.env.CLAWSCARF_NATIVE_TEST_CONFIG;
const sessionPath = process.env.CLAWSCARF_NATIVE_TEST_SESSION_FILE;
const directory = process.env.CLAWSCARF_TEST_EXECUTION_DIRECTORY;
const executionEnabled = process.env.CLAWSCARF_TEST_EXECUTION === "1";
const browserEnabled = process.env.CLAWSCARF_TEST_NATIVE_BROWSER === "1";
const receiptSchema = z.object({
  ownerId: z.uuid(),
  id: z.uuid(),
  name: z.string(),
});
const sessionSchema = z.object({ key: z.string() });
const historySchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())),
});
const proofSchema = z.object({
  nonce: z.string(),
  uid: z.literal(1000),
  marker: z.string(),
  cwd: z.string(),
  nativeConfigurationVisible: z.literal(true),
  endpoints: z
    .array(z.object({ name: z.string(), connected: z.literal(false) }))
    .length(3),
});

await test(
  "assembled native member and administrator tools share the protected team runtime",
  {
    skip: !executionEnabled && !browserEnabled,
    timeout: 600000,
  },
  async (t) => {
    assert.ok(
      configPath && sessionPath && directory,
      "Explicit native config, administrator session and installation directory are required",
    );
    const state = await readState(directory);
    const gatewayReceipt = receiptSchema.parse(
      JSON.parse(await readFile(join(directory, "runtime.json"), "utf8")),
    );
    assert.equal(gatewayReceipt.ownerId, state.ownerId);
    const gatewayBinding = await verifyRuntimeBinding(state, gatewayReceipt);
    const config = await readConfiguration(configPath);
    const app = await composeAccess(config);
    const actor = await app.access.authenticate(
      (await readFile(sessionPath, "utf8")).trim(),
    );
    const team = new EnrollmentService(
      app.repository,
      app.native,
      config.origin,
      "https://execution.clawscarf.test",
    );
    const nonce = randomUUID();
    const ownedFiles: string[] = [];
    const clients: GatewayClient[] = [];
    const sessions: string[] = [];
    let memberId: string | undefined;
    const failures: unknown[] = [];
    let cleanupGateway: GatewayClient | undefined;
    let currentGateway: GatewayClient | undefined;
    let currentSession: string | undefined;
    let nativeOutcome: unknown;
    async function connect(
      credential: string,
      scopes: string[],
    ): Promise<GatewayClient> {
      const endpoint = new URL(
        config.runtime.managementOrigin ?? config.origin,
      );
      endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      const ready = Promise.withResolvers<void>();
      const client = new GatewayClient({
        url: endpoint.href,
        origin: config.origin,
        edgeAuthHeaders: {
          Host: new URL(config.origin).host,
          Cookie: `clawscarf_session=${credential}`,
        },
        clientName: "gateway-client",
        clientVersion: "2026.9.4",
        mode: "backend",
        role: "operator",
        minProtocol: 4,
        maxProtocol: 4,
        scopes,
        deviceIdentity: null,
        requestTimeoutMs: 15000,
        hostDeps: { logDebug() {}, logError() {} },
        onHelloOk: () => ready.resolve(),
        onConnectError: (error) => ready.reject(error),
      });
      clients.push(client);
      client.start();
      const timer = setTimeout(
        () =>
          ready.reject(new Error("Native execution test connection timed out")),
        15000,
      );
      try {
        await ready.promise;
      } finally {
        clearTimeout(timer);
      }
      return client;
    }
    async function chat(
      gateway: GatewayClient,
      sessionKey: string,
      message: string,
    ) {
      const submitted = z.object({ runId: z.string() }).parse(
        await gateway.request<unknown>("chat.send", {
          sessionKey: sessionKey,
          agentId: "main",
          message,
          idempotencyKey: randomUUID(),
          timeoutMs: 120000,
        }),
      );
      const deadline = Date.now() + 140000;
      let finished = false;
      while (Date.now() < deadline) {
        nativeOutcome = await gateway.request<unknown>("agent.wait", {
          runId: submitted.runId,
          timeoutMs: 5000,
        });
        const result = z.object({ status: z.string() }).parse(nativeOutcome);
        if (result.status === "timeout") continue;
        assert.equal(
          result.status,
          "ok",
          "Native run must complete without an agent error",
        );
        finished = true;
        break;
      }
      assert.ok(
        finished,
        "Native execution run did not finish; it will not be replayed",
      );
      return historySchema.parse(
        await gateway.request<unknown>("chat.history", {
          sessionKey: sessionKey,
          agentId: "main",
          limit: 100,
        }),
      );
    }
    function toolCalls(history: z.infer<typeof historySchema>) {
      return history.messages
        .flatMap(
          (message) =>
            z.array(z.unknown()).safeParse(message.content).data ?? [],
        )
        .flatMap((part) => {
          const parsed = z
            .object({
              type: z.literal("toolCall"),
              id: z.string(),
              name: z.string(),
              arguments: z.record(z.string(), z.unknown()),
            })
            .safeParse(part);
          return parsed.success ? [parsed.data] : [];
        });
    }
    try {
      const fixture = {
        issuer: "https://execution.clawscarf.test",
        subject: nonce,
        email: `execution-${nonce}@example.test`,
        name: "Execution test member",
        emailVerified: false,
      };
      memberId = (await app.repository.prepareEnrollment(fixture)).id;
      const person = await team.enroll(actor, fixture);
      const credential = token();
      await app.repository.createSession(
        person.id,
        hash(credential),
        token(),
        null,
      );
      const member = await connect(credential, [
        "operator.read",
        "operator.write",
      ]);
      currentGateway = member;
      await assert.rejects(
        member.request<unknown>("exec.approvals.get", {}),
        isAccessDenied,
      );
      cleanupGateway = await connect(
        (await readFile(sessionPath, "utf8")).trim(),
        ["operator.admin"],
      );
      await cleanupGateway.request<unknown>("exec.approvals.get", {});
      if (browserEnabled) {
        z.object({
          config: z.object({
            gateway: z.object({
              nodes: z.object({
                browser: z.object({
                  mode: z.enum(["auto", "manual"]),
                  node: z.string().min(1),
                }),
              }),
            }),
          }),
        }).parse(await cleanupGateway.request<unknown>("config.get", {}));
      }
      for (const probe of [
        { kind: "member", gateway: member },
        { kind: "administrator", gateway: cleanupGateway },
      ]) {
        currentGateway = probe.gateway;
        const marker = `clawscarf-execution-${nonce}-${probe.kind}.json`;
        const toolFile = `clawscarf-tools-${nonce}-${probe.kind}.txt`;
        const proofPath = `/home/node/${marker}`;
        const scriptFile = `clawscarf-probe-${nonce}-${probe.kind}.py`;
        const scriptPath = `/home/node/${scriptFile}`;
        ownedFiles.push(marker, toolFile, scriptFile);
        const session = sessionSchema.parse(
          await probe.gateway.request<unknown>("sessions.create", {
            agentId: "main",
            label: `Execution ${nonce} ${probe.kind}`,
            idempotencyKey: randomUUID(),
          }),
        );
        sessions.push(session.key);
        currentSession = session.key;
        if (browserEnabled) {
          const url = `https://example.com/?clawscarf-test=${nonce}-${probe.kind}`;
          const browserHistory = await chat(
            probe.gateway,
            session.key,
            `Use the browser to open ${url} as a new tab, read its heading, then close that same tab. Do not inspect, navigate, or close other tabs. Do not use exec, curl, or web_fetch. Report actual failures truthfully. Do not change configuration or permissions.`,
          );
          const calls = toolCalls(browserHistory).filter(
            (call) => call.name === "browser",
          );
          const successfulCalls = calls.filter((call) =>
            browserHistory.messages.some(
              (message) =>
                message.role === "toolResult" &&
                message.toolCallId === call.id &&
                message.isError !== true,
            ),
          );
          const actions = ["open", "snapshot", "close"];
          for (const action of actions) {
            const call = successfulCalls.find(
              (entry) =>
                entry.arguments.action === action ||
                (action === "snapshot" && entry.arguments.action === "text"),
            );
            assert.ok(
              call,
              `Native browser ${action} must run without routing hints in the prompt`,
            );
            assert.equal(call.arguments.target, undefined);
            assert.equal(call.arguments.node, undefined);
            const result = browserHistory.messages.find(
              (message) =>
                message.role === "toolResult" && message.toolCallId === call.id,
            );
            assert.ok(
              result && result.isError !== true,
              `Native browser ${action} must succeed`,
            );
          }
          const snapshot = successfulCalls.find(
            (entry) =>
              entry.arguments.action === "snapshot" ||
              entry.arguments.action === "text",
          );
          const close = successfulCalls.find(
            (entry) => entry.arguments.action === "close",
          );
          assert.ok(
            typeof snapshot?.arguments.targetId === "string" &&
              snapshot.arguments.targetId.length > 0,
          );
          assert.equal(
            close?.arguments.targetId,
            snapshot.arguments.targetId,
            "Close only the target used for this probe",
          );
          assert.match(
            JSON.stringify(
              browserHistory.messages.filter(
                (message) => message.role === "toolResult",
              ),
            ),
            /Example Domain/,
          );
          t.diagnostic(
            `${probe.kind}: model-selected browser opened, observed and closed its own public test page using default routing.`,
          );
        }
        if (!executionEnabled) continue;
        const endpoints = [
          {
            name: "gateway-host",
            host: "host.docker.internal",
            port: state.input.ports.native,
          },
          {
            name: "controller-host",
            host: "host.docker.internal",
            port: state.input.ports.controller,
          },
          { name: "undeclared-public-egress", host: "1.1.1.1", port: 443 },
        ];
        const script = `import os,json,socket,pathlib\nresult={'nonce':${JSON.stringify(nonce)},'uid':os.getuid(),'cwd':str(pathlib.Path.cwd()),'marker':${JSON.stringify(proofPath)},'nativeConfigurationVisible':pathlib.Path('/home/node/.openclaw/clawscarf-installation.json').exists(),'endpoints':[]}\nfor endpoint in json.loads(${JSON.stringify(JSON.stringify(endpoints))}):\n try:\n  connection=socket.create_connection((endpoint['host'],endpoint['port']),timeout=2);connection.close();connected=True\n except OSError:\n  connected=False\n result['endpoints'].append({'name':endpoint['name'],'connected':connected})\npathlib.Path(${JSON.stringify(proofPath)}).write_text(json.dumps(result))\nprint(pathlib.Path(${JSON.stringify(proofPath)}).read_text())\n`;
        await run(
          "docker",
          [
            "exec",
            "--user",
            "1000:1000",
            "-i",
            gatewayBinding.containerId,
            "python3",
            "-c",
            "import pathlib,sys;p=pathlib.Path(sys.argv[1]);p.write_text(sys.stdin.read());p.chmod(0o600)",
            scriptPath,
          ],
          { input: script },
        );
        const command = `python3 ${scriptPath}`;
        const fileInstructions = `Create the relative file ${toolFile} containing exactly ${nonce} and read it back using the native file tools. Then run the command.`;
        const prompt = `Perform this bounded installation acceptance test using your actual tools. ${fileInstructions} The operator has placed the nonce-scoped probe script in your team runtime. Run this exact command once with exec (use host gateway, do not request elevated access):\n${command}\nThe command only writes its unique test files and checks three TCP connection outcomes. Do not make other network requests or inspect credentials. Report failures truthfully. Do not change configuration or permissions.`;
        const history = await chat(probe.gateway, session.key, prompt);
        const calls = toolCalls(history);
        assert.ok(
          calls.some(
            (call) =>
              call.name === "exec" && call.arguments.command === command,
          ),
          "History must show execution of the exact probe, not a model claim",
        );
        const results = history.messages.filter(
          (message) => message.role === "toolResult",
        );
        const probeCall = calls.find(
          (call) => call.name === "exec" && call.arguments.command === command,
        );
        assert.ok(
          results.some(
            (message) =>
              message.toolCallId === probeCall?.id && message.isError !== true,
          ),
          "The native execution probe must return a tool result",
        );
        const writeCalls = calls.filter(
          (call) =>
            call.name === "write" &&
            JSON.stringify(call.arguments).includes(toolFile),
        );
        assert.ok(
          results.some(
            (message) =>
              writeCalls.some((call) => call.id === message.toolCallId) &&
              message.isError !== true,
          ),
          "Native write must create the shared file for both roles",
        );
        const readCalls = calls.filter(
          (call) =>
            call.id !== probeCall?.id &&
            call.name === "read" &&
            JSON.stringify(call.arguments).includes(toolFile),
        );
        assert.ok(
          results.some(
            (message) =>
              readCalls.some((call) => call.id === message.toolCallId) &&
              message.isError !== true &&
              JSON.stringify(message.content).includes(nonce),
          ),
          "A native file read must return the nonce, not just an assistant assertion",
        );
        const proof = proofSchema.parse(
          JSON.parse(
            await run("docker", [
              "exec",
              gatewayBinding.containerId,
              "cat",
              proofPath,
            ]),
          ),
        );
        assert.equal(proof.nonce, nonce);
        assert.equal(proof.marker, proofPath);
        assert.deepEqual(
          proof.endpoints.map((endpoint) => endpoint.name),
          endpoints.map((endpoint) => endpoint.name),
        );
        assert.equal(proof.cwd, "/home/node/.openclaw/workspace");
        assert.equal(
          await run("docker", [
            "exec",
            gatewayBinding.containerId,
            "cat",
            join(proof.cwd, toolFile),
          ]),
          nonce,
          "The native tool file must exist with the exact content in the runtime",
        );
        t.diagnostic(
          `${probe.kind}: native tools used the owned UID1000 runtime; all three forbidden TCP destinations failed.`,
        );
      }
      t.diagnostic(
        "Member administrative RPC denied; existing administrator authority preserved. Each enabled native tool probe completed separately for both actors.",
      );
    } catch (error) {
      failures.push(error);
      if (currentGateway && currentSession) {
        try {
          const history = await currentGateway.request<unknown>(
            "chat.history",
            {
              sessionKey: currentSession,
              agentId: "main",
              limit: 100,
            },
          );
          await writeFile(
            join(directory, "execution-acceptance.json"),
            JSON.stringify({ nonce, nativeOutcome, history }, null, 2),
            { mode: 0o600 },
          );
        } catch (diagnosticError) {
          failures.push(diagnosticError);
        }
      }
    } finally {
      try {
        if (cleanupGateway)
          for (const key of sessions) {
            await cleanupGateway.request<unknown>("chat.abort", {
              sessionKey: key,
              agentId: "main",
            });
            await cleanupGateway.request<unknown>("sessions.delete", {
              key,
              agentId: "main",
              deleteTranscript: true,
            });
          }
      } catch (error) {
        failures.push(error);
      }
      for (const client of clients) {
        try {
          await client.stopAndWait({ timeoutMs: 2000 });
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        if (memberId) await team.remove(actor, memberId);
      } catch (error) {
        failures.push(error);
      }
      try {
        await run("docker", [
          "exec",
          gatewayBinding.containerId,
          "python3",
          "-c",
          "import pathlib,sys;root=pathlib.Path('/home/node');[(p.unlink()) for name in sys.argv[1:] for p in root.rglob(name) if p.is_file()]",
          ...ownedFiles,
        ]);
      } catch (error) {
        failures.push(error);
      }
      try {
        await app.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Native execution acceptance or owned fixture cleanup failed",
      );
  },
);
