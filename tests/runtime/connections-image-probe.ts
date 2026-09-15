import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

// Executed only inside a disposable image container; the broker is a controlled TLS fixture.
const execute = promisify(execFile);
const ownerId = randomUUID(),
  serverId = randomUUID();
const credential = "synthetic-scoped-connection-token";
const gatewayToken = "synthetic-native-gateway-token";
const brokerUrl = "https://localhost:18444/team";
const ca = await readFile("/fixture/cert.pem", "utf8");
const broker = createServer(
  { cert: ca, key: await readFile("/fixture/key.pem") },
  (request, response) => {
    if (request.headers.authorization !== `Bearer ${credential}`) {
      response.writeHead(401).end();
      return;
    }
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/team/v1/connector-runtime/search");
    requests++;
    let input = "";
    request.setEncoding("utf8").on("data", (chunk: string) => {
      input += chunk;
    });
    request.on("end", () => {
      const value: unknown = JSON.parse(input);
      assert.ok(value && typeof value === "object" && "context" in value);
      const context = value.context;
      assert.ok(context && typeof context === "object" && "agentId" in context);
      assert.equal(context.agentId, "main");
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ items: [], nextCursor: null, guidance: null }));
    });
  },
);
let requests = 0;
broker.listen(18444, "127.0.0.1");
await once(broker, "listening");
const configuration = {
  gateway: {
    mode: "local",
    bind: "loopback",
    port: 18789,
    auth: { mode: "token", token: gatewayToken },
  },
  agents: {
    defaults: { workspace: "/home/node/workspace" },
    entries: { main: { default: true } },
  },
  plugins: { entries: { "clawscarf-connections": { enabled: true } } },
  tools: { allow: ["clawscarf-connections"] },
  browser: { enabled: false },
};
async function nativeHelper(path: string, input: unknown, root = false) {
  const child = execute("/usr/local/bin/node", [path], {
    uid: root ? 0 : 1000,
    gid: root ? 0 : 1000,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
  child.child.stdin?.end(JSON.stringify(input));
  const result = await child;
  assert.ok(
    !result.stdout.includes(credential) && !result.stderr.includes(credential),
  );
  return result.stdout ? (JSON.parse(result.stdout) as unknown) : undefined;
}
let gateway: ChildProcess | undefined;
let diagnostic = "";
async function stop() {
  if (!gateway || gateway.exitCode !== null || gateway.signalCode !== null)
    return;
  const target = gateway;
  const exited = once(target, "exit");
  const timer = setTimeout(() => target.kill("SIGKILL"), 10_000);
  timer.unref();
  target.kill("SIGTERM");
  try {
    await exited;
    assert.ok(!diagnostic.includes(credential));
  } finally {
    clearTimeout(timer);
  }
}
async function start() {
  diagnostic = "";
  gateway = spawn("/app/clawscarf/bin/openclaw", ["gateway", "run"], {
    uid: 1000,
    gid: 1000,
    cwd: "/home/node",
    env: {
      ...process.env,
      OPENCLAW_DISABLE_BONJOUR: "1",
      OPENCLAW_EXEC_SHELL_SNAPSHOT: "0",
      OPENCLAW_NO_RESPAWN: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [gateway.stdout, gateway.stderr])
    stream?.setEncoding("utf8").on("data", (chunk: string) => {
      diagnostic = (diagnostic + chunk).slice(-16_000);
    });
  for (let attempt = 0; attempt < 160; attempt++) {
    assert.equal(gateway.exitCode, null, diagnostic);
    try {
      const result = await fetch("http://127.0.0.1:18789/readyz", {
        signal: AbortSignal.timeout(500),
      });
      if (result.ok) return;
    } catch {
      /* Gateway has not bound its isolated listener yet. */
    }
    await delay(250);
  }
  throw Error("Gateway readiness failed: " + diagnostic);
}
async function search() {
  const response = await fetch("http://127.0.0.1:18789/tools/invoke", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${gatewayToken}`,
    },
    body: JSON.stringify({
      tool: "connections_search",
      args: {},
      agentId: "main",
      idempotencyKey: randomUUID(),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  assert.equal(response.status, 200, body);
  assert.ok(!body.includes(credential));
  assert.match(body, /"items":\[\]/u);
  assert.doesNotMatch(
    body,
    /broker_unavailable|invalid_credential|isError":true/u,
  );
}
try {
  await nativeHelper(
    "/app/clawscarf/initialize-main.js",
    { ownerId, serverId, configuration: JSON.stringify(configuration) },
    true,
  );
  const configured = await nativeHelper(
    "/app/clawscarf/configure-connections-main.js",
    {
      kind: "configure",
      ownerId,
      serverId,
      brokerUrl,
      credential: { token: credential, ca },
    },
  );
  assert.ok(
    configured && typeof configured === "object" && "state" in configured,
  );
  assert.equal(configured.state, "configured");
  assert.ok(
    "credentialMatches" in configured && configured.credentialMatches === true,
  );
  await start();
  await search();
  assert.equal(requests, 1);
  await stop();
  await start();
  await search();
  assert.equal(requests, 2);
  assert.ok(!diagnostic.includes(credential));
  process.stdout.write(
    "Packaged configuration, launcher credential/CA delivery, native search and retained restart passed.\n",
  );
} finally {
  await stop();
  await new Promise<void>((resolve, reject) =>
    broker.close((error) => (error ? reject(error) : resolve())),
  );
}
