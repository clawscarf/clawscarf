import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";
import console from "node:console";
import { setTimeout as delay } from "node:timers/promises";
const { fetch } = globalThis;
const WebSocket = createRequire("/app/package.json")("ws");

// Runs inside a disposable OpenShell runtime. The only model is a loopback fixture:
// it proves native upload/tool/transport plumbing, not model quality or inference egress.
const workspace = "/home/node/.openclaw/workspace";
const state = "/home/node/.openclaw";
const nonce = "team-runtime-proof-" + process.pid;
const adminIdentity = "clawscarf:proof-admin";
const memberIdentity = "clawscarf:proof-member";
let sessionKey = "agent:main:proof";
let modelReply = "PDF and chat fixture acknowledged.";
const endpoint = "http://127.0.0.1:18789";
const payloads = [];
const queuedTools = [];
const model = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  payloads.push(payload);
  const result = {
    id: "proof",
    object: "chat.completion",
    created: 1,
    model: "proof",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "PDF and chat fixture acknowledged.",
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
  const tool = queuedTools.shift();
  const message = tool
    ? {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            index: 0,
            id: tool.id,
            type: "function",
            function: { name: tool.name, arguments: JSON.stringify(tool.args) },
          },
        ],
      }
    : { role: "assistant", content: modelReply };
  const finish = tool ? "tool_calls" : "stop";
  if (payload.stream) {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ ...result, object: "chat.completion.chunk", choices: [{ index: 0, delta: message, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...result, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`,
    );
  } else {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        ...result,
        choices: [{ index: 0, message, finish_reason: finish }],
      }),
    );
  }
});
model.listen(18990, "127.0.0.1");
await once(model, "listening");
await mkdir(workspace, { recursive: true });
await writeFile(
  join(state, "openclaw.json"),
  JSON.stringify({
    gateway: {
      mode: "local",
      bind: "loopback",
      port: 18789,
      trustedProxies: ["127.0.0.1"],
      publicOrigin: endpoint,
      controlUi: { allowedOrigins: [endpoint] },
      auth: {
        mode: "trusted-proxy",
        trustedProxy: {
          userHeader: "x-openclaw-user",
          requiredHeaders: ["x-forwarded-proto", "x-forwarded-host"],
          allowUsers: [adminIdentity, memberIdentity],
          allowLoopback: true,
        },
        identityScopes: {
          [adminIdentity]: ["operator.admin"],
          [memberIdentity]: ["operator.read", "operator.write"],
        },
      },
      roles: {
        default: "admin",
        definitions: {
          admin: {
            agents: "*",
            scopes: ["operator.admin"],
            sessions: { others: "write" },
          },
          member: {
            agents: "*",
            scopes: ["operator.read", "operator.write", "operator.talk"],
            sessions: { others: "none" },
            sandbox: "inherit",
          },
        },
      },
      tools: { allow: ["exec", "read", "write", "edit", "pdf", "lobster"] },
    },
    agents: {
      defaults: {
        workspace,
        sandbox: { mode: "off" },
        model: { primary: "fixture/proof" },
        pdfModel: { primary: "fixture/proof" },
      },
    },
    tools: { alsoAllow: ["lobster"], exec: { host: "gateway", mode: "full" } },
    plugins: {
      allow: ["lobster", "document-extract"],
      load: {
        paths: ["/app/clawscarf/native-plugins/node_modules/@openclaw/lobster"],
      },
      entries: { lobster: { enabled: true } },
    },
    models: {
      catalogRefresh: { enabled: false },
      providers: {
        fixture: {
          baseUrl: "http://127.0.0.1:18990/v1",
          apiKey: "synthetic",
          api: "openai-completions",
          models: [
            {
              id: "proof",
              name: "Proof",
              input: ["text"],
              contextWindow: 200000,
              maxTokens: 1024,
            },
          ],
        },
      },
    },
    discovery: { mdns: { mode: "off" } },
  }),
  { mode: 0o600 },
);
const gateway = spawn("/app/clawscarf/bin/openclaw", ["gateway"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
gateway.stdout.on("data", (chunk) => {
  logs += chunk;
});
gateway.stderr.on("data", (chunk) => {
  logs += chunk;
});
let socket;
const sockets = [];
const pending = new Map();
let sequence = 0;
async function sendRpc(client, method, params) {
  const id = String(++sequence);
  const promise = Promise.withResolvers();
  pending.set(id, promise);
  client.send(JSON.stringify({ type: "req", id, method, params }));
  return Promise.race([
    promise.promise,
    delay(45000, undefined, { ref: false }).then(() => {
      throw Error("RPC timeout: " + method);
    }),
  ]);
}
const rpc = (method, params) => sendRpc(socket, method, params);
async function connect(identity, scopes) {
  const client = new WebSocket("ws://127.0.0.1:18789", {
    origin: endpoint,
    headers: {
      "x-openclaw-user": identity,
      "x-forwarded-proto": "http",
      "x-forwarded-for": "203.0.113.10",
      "x-forwarded-host": "127.0.0.1:18789",
    },
  });
  sockets.push(client);
  const ready = Promise.withResolvers();
  client.on("error", ready.reject);
  client.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === "event" && message.event === "connect.challenge") {
      sendRpc(client, "connect", {
        minProtocol: 4,
        maxProtocol: 4,
        client: {
          id: "gateway-client",
          version: "2026.9.4",
          platform: "linux",
          mode: "backend",
        },
        role: "operator",
        scopes,
      }).then(ready.resolve, ready.reject);
    } else if (message.type === "res") {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.ok) waiting?.resolve(message.payload);
      else waiting?.reject(Error(JSON.stringify(message.error)));
    }
  });
  await ready.promise;
  return client;
}
async function chat(attachments = []) {
  const run = await rpc("chat.send", {
    sessionKey,
    message:
      "Run the bounded test step using the requested native tool, then acknowledge.",
    attachments,
    idempotencyKey: randomUUID(),
  });
  const finished = await rpc("agent.wait", {
    runId: run.runId,
    timeoutMs: 30000,
  });
  assert.equal(finished.status, "ok", JSON.stringify(finished));
}
async function invoke(tool, args) {
  if (["read", "write", "edit", "exec", "pdf"].includes(tool)) {
    const id = "call_" + randomUUID().replaceAll("-", "");
    queuedTools.push({ id, name: tool, args });
    await chat();
    const history = await rpc("chat.history", { sessionKey, limit: 100 });
    const result = history.messages.find(
      (message) => message.role === "toolResult" && message.toolCallId === id,
    );
    assert.ok(result, JSON.stringify(history));
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return result;
  }
  const result = await rpc("tools.invoke", { name: tool, args, sessionKey });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.notEqual(result.output?.isError, true, JSON.stringify(result));
  return result.output;
}
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (gateway.exitCode !== null) throw Error(logs);
    if (
      await fetch(endpoint + "/readyz").then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    await delay(500);
  }
  socket = await connect(adminIdentity, [
    "operator.admin",
    "operator.read",
    "operator.write",
  ]);
  await invoke("write", { path: "earlier.txt", content: nonce });
  assert.match(
    JSON.stringify(await invoke("read", { path: "earlier.txt" })),
    new RegExp(nonce),
  );
  // Upload only after tools have already used this runtime/workspace.
  await chat([
    {
      type: "file",
      mimeType: "text/plain",
      fileName: "after-first-use.txt",
      content: Buffer.from(nonce).toString("base64"),
    },
  ]);
  async function findUpload(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) {
        const result = await findUpload(path);
        if (result) return result;
      } else if (
        path.endsWith(".txt") &&
        (await readFile(path, "utf8")) === nonce
      )
        return path;
    }
  }
  const uploaded = await findUpload(join(state, "media"));
  assert.ok(uploaded, "chat.send must persist the actual uploaded document");
  assert.match(
    JSON.stringify(await invoke("read", { path: uploaded })),
    new RegExp(nonce),
  );
  const edit = `from pathlib import Path; p=Path(${JSON.stringify(uploaded)}); Path('edited.txt').write_text(p.read_text()+' edited')`;
  await invoke("exec", {
    command: `python3 -c ${"'" + edit.replaceAll("'", "'\\''") + "'"}`,
  });
  const lobster = await invoke("lobster", {
    action: "run",
    pipeline: "exec --shell 'cat edited.txt'",
  });
  assert.match(JSON.stringify(lobster), new RegExp(nonce + " edited"));
  // Native approval/resume must not replay the pre-approval shell step.
  const paused = await invoke("lobster", {
    action: "run",
    pipeline:
      "exec --shell 'echo once >> once.txt; cat edited.txt' | approve --prompt 'Proceed?'",
  });
  assert.equal(paused.details.status, "needs_approval", JSON.stringify(paused));
  const resumed = await invoke("lobster", {
    action: "resume",
    token: paused.details.requiresApproval.resumeToken,
    approve: true,
  });
  assert.equal(resumed.details.status, "ok", JSON.stringify(resumed));
  assert.equal(await readFile(join(workspace, "once.txt"), "utf8"), "once\n");
  // A real uploaded PDF passes native extraction into a controlled model request.
  const pdfText = (nonce + " PDF extraction proof. ").repeat(10);
  const stream = `BT /F1 12 Tf 20 750 Td (${pdfText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, "0") + " 00000 n ")
    .join(
      "\n",
    )}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await chat([
    {
      type: "file",
      mimeType: "application/pdf",
      fileName: "proof.pdf",
      content: Buffer.from(pdf).toString("base64"),
    },
  ]);
  const documents = await readdir(join(state, "media"), { recursive: true });
  const pdfRelative = documents.find((path) => path.endsWith(".pdf"));
  assert.ok(pdfRelative, "Native upload must persist the PDF");
  const beforePdf = payloads.length;
  assert.match(
    JSON.stringify(
      await invoke("pdf", {
        pdf: join(state, "media", pdfRelative),
        prompt: "Summarize the PDF extraction proof.",
      }),
    ),
    /fixture acknowledged/,
  );
  assert.match(
    JSON.stringify(payloads.slice(beforePdf)),
    new RegExp(nonce + " PDF extraction proof"),
  );

  modelReply =
    "Here is the edited document.\nMEDIA:" + join(workspace, "edited.txt");
  await chat();
  const returned = await rpc("chat.history", { sessionKey, limit: 10 });
  assert.ok(
    returned.messages.some(
      (message) =>
        message.role === "assistant" &&
        JSON.stringify(message).includes("edited.txt"),
    ),
    "Chat must expose the output document",
  );
  modelReply = "PDF and chat fixture acknowledged.";

  const script = `import errno,os,pathlib,socket
assert os.getuid()==1000
assert pathlib.Path('/home/node/.openclaw').is_dir()
assert 'NoNewPrivs:\t1' in pathlib.Path('/proc/self/status').read_text()
for path in ['/var/run/docker.sock','/run/docker.sock','/root/.ssh']:
 try: os.stat(path)
 except (PermissionError,FileNotFoundError): pass
 else: raise AssertionError(path)
try: pathlib.Path('/etc/openshell/tls/client/tls.key').read_bytes()
except (PermissionError,FileNotFoundError): pass
else: raise AssertionError('controller credential readable')
try: pathlib.Path('/app/denied-proof').write_text('no')
except PermissionError: pass
else: raise AssertionError('writable app')
try: socket.create_connection(('1.1.1.1',443),2)
except OSError as error: assert error.errno in [errno.EACCES,errno.EPERM,errno.ECONNREFUSED]
else: raise AssertionError('undeclared egress')
print('outer-boundary-passed')
`;
  await invoke("write", { path: "boundary.py", content: script });
  assert.match(
    JSON.stringify(await invoke("exec", { command: "python3 boundary.py" })),
    /outer-boundary-passed/,
  );
  assert.match(
    JSON.stringify(
      await invoke("lobster", {
        action: "run",
        pipeline: "exec --shell 'python3 boundary.py'",
      }),
    ),
    /outer-boundary-passed/,
  );
  const administrator = socket;
  const candidate = await connect(memberIdentity, [
    "operator.read",
    "operator.write",
  ]);
  const { profile } = await sendRpc(candidate, "users.self", {});
  await rpc("users.setRole", { profileId: profile.id, role: "member" });
  candidate.close();
  socket = await connect(memberIdentity, ["operator.read", "operator.write"]);
  await assert.rejects(
    rpc("exec.approvals.get", {}),
    /scope|denied|forbidden/i,
  );
  const memberSession = await rpc("sessions.create", {
    agentId: "main",
    label: "Member runtime proof",
    idempotencyKey: randomUUID(),
  });
  sessionKey = memberSession.key;
  await invoke("write", { path: "member.txt", content: "member-shared-file" });
  assert.match(
    JSON.stringify(await invoke("exec", { command: "cat member.txt" })),
    /member-shared-file/,
  );
  assert.match(
    JSON.stringify(
      await invoke("lobster", {
        action: "run",
        pipeline: "exec --shell 'cat member.txt'",
      }),
    ),
    /member-shared-file/,
  );
  socket.close();
  socket = administrator;
  await rpc("exec.approvals.get", {});
  await writeFile(
    join(workspace, "team-runtime-proof.json"),
    JSON.stringify({ uploaded, nonce, cwd: workspace }),
  );
  console.log(
    "Native upload → read → Python → Lobster → chat; PDF extraction; approval/resume; member roles; shell and Lobster outer confinement passed.",
  );
} catch (error) {
  console.error(logs.slice(-16000));
  throw error;
} finally {
  for (const client of sockets) client.close();
  gateway.kill("SIGTERM");
  if (gateway.exitCode === null) await once(gateway, "exit").catch(() => {});
  model.closeAllConnections();
  model.close();
}
