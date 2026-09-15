import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { request } from "node:http";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

async function docker(args: string[], input?: string): Promise<string> {
  return await new Promise((resolveOutput, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "",
      error = "";
    child.stdout.setEncoding("utf8").on("data", (value: string) => {
      output += value;
    });
    child.stderr.setEncoding("utf8").on("data", (value: string) => {
      error += value;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveOutput(output.trim());
      else reject(new Error(`Docker command failed (${code}): ${error}`));
    });
    child.stdin.end(input);
  });
}
async function upgrade(
  endpoint: string,
  authorization?: string,
  originHeader?: string,
): Promise<number | undefined> {
  return await new Promise((resolveStatus, reject) => {
    const url = new URL(endpoint);
    if (url.protocol === "ws:") url.protocol = "http:";
    const req = request(url, {
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        ...(authorization ? { Authorization: authorization } : {}),
        ...(originHeader ? { Origin: originHeader } : {}),
      },
    });
    req.setTimeout(3000, () => req.destroy(new Error("CDP upgrade timed out")));
    req.once("error", reject);
    req.once("response", (response) => {
      response.resume();
      resolveStatus(response.statusCode);
    });
    req.once("upgrade", (response, socket) => {
      socket.destroy();
      resolveStatus(response.statusCode);
    });
    req.end();
  });
}
async function pipeline(
  origin: string,
  authorization: string,
): Promise<number[]> {
  const url = new URL(origin);
  return await new Promise((resolveStatuses, reject) => {
    const socket = createConnection({
      host: url.hostname,
      port: Number(url.port),
    });
    let output = "";
    socket.setEncoding("utf8");
    socket.setTimeout(3000, () =>
      socket.destroy(new Error("CDP pipeline timed out")),
    );
    socket.once("error", reject);
    socket.on("data", (data: string) => {
      output += data;
    });
    socket.once("end", () =>
      resolveStatuses(
        [...output.matchAll(/HTTP\/1\.1 (\d{3}) /g)].map((match) =>
          Number(match[1]),
        ),
      ),
    );
    socket.once("connect", () =>
      socket.write(
        `GET /json/version HTTP/1.1\r\nHost: ${url.host}\r\nAuthorization: ${authorization}\r\n\r\nGET /json/version HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`,
      ),
    );
  });
}
const image = process.env.CLAWSCARF_TEST_BROWSER_IMAGE;
await test(
  "separate browser retains its sandbox, authenticated CDP and persistent profile",
  { skip: !image, timeout: 120000 },
  async (t) => {
    assert.ok(image);
    const name = `clawscarf-browser-test-${randomUUID()}`;
    const state = `${name}-state`,
      secrets = `${name}-secrets`;
    const token = randomBytes(32).toString("hex");
    const authorization = `Basic ${Buffer.from(`openclaw:${token}`).toString("base64")}`;
    await docker([
      "volume",
      "create",
      "--label",
      "io.clawscarf.test=browser",
      state,
    ]);
    await docker([
      "volume",
      "create",
      "--label",
      "io.clawscarf.test=browser",
      secrets,
    ]);
    try {
      await docker(
        [
          "run",
          "--rm",
          "-i",
          "--network",
          "none",
          "--user",
          "0",
          "--cap-drop",
          "ALL",
          "--cap-add",
          "CHOWN",
          "--mount",
          `source=${state},target=/state`,
          "--mount",
          `source=${secrets},target=/secrets`,
          "--entrypoint",
          "node",
          image,
          "-e",
          'const fs=require("node:fs"); let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{fs.writeFileSync("/secrets/token",s,{mode:0o600});fs.chownSync("/secrets/token",1000,1000);fs.chownSync("/state",1000,1000)})',
        ],
        token,
      );
      await docker([
        "run",
        "-d",
        "--name",
        name,
        "--init",
        "--label",
        "io.clawscarf.test=browser",
        "--network",
        "bridge",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=512m",
        "--shm-size=256m",
        "--memory=1g",
        "--pids-limit=256",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--security-opt",
        `seccomp=${resolve("deploy/execution/browser/seccomp.json")}`,
        "--mount",
        `source=${state},target=/state`,
        "--mount",
        `source=${secrets},target=/secrets,readonly`,
        "-e",
        "CLAWSCARF_BROWSER_TOKEN_FILE=/secrets/token",
        "-p",
        "127.0.0.1::9223",
        image,
      ]);
      const published = await docker(["port", name, "9223/tcp"]);
      let origin = `http://${published}`;
      async function ready(): Promise<void> {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          try {
            const response = await fetch(`${origin}/json/version`, {
              headers: { Authorization: authorization },
              signal: AbortSignal.timeout(500),
            });
            await response.body?.cancel();
            if (response.ok) return;
          } catch {
            /* Wait for startup, never replay a mutation. */
          }
          await delay(100);
        }
        throw new Error("Browser relay did not become ready");
      }
      await ready();
      assert.deepEqual(await pipeline(origin, authorization), [200, 401]);
      for (const auth of [undefined, "Bearer wrong"]) {
        const response = await fetch(`${origin}/json/version`, {
          headers: auth ? { Authorization: auth } : {},
          signal: AbortSignal.timeout(3000),
        });
        assert.equal(response.status, 401);
        await response.body?.cancel();
        assert.equal(
          await upgrade(`${origin}/devtools/browser/invalid`, auth),
          401,
        );
      }
      const crossOrigin = await fetch(`${origin}/json/version`, {
        headers: {
          Authorization: authorization,
          Origin: "https://untrusted.test",
        },
      });
      assert.equal(crossOrigin.status, 403);
      await crossOrigin.body?.cancel();
      assert.equal(
        await upgrade(
          `${origin}/devtools/browser/invalid`,
          authorization,
          "https://untrusted.test",
        ),
        403,
      );
      function advertisedUrl(value: unknown): string {
        assert.ok(
          value && typeof value === "object" && "webSocketDebuggerUrl" in value,
        );
        assert.equal(typeof value.webSocketDebuggerUrl, "string");
        const endpoint = new URL(String(value.webSocketDebuggerUrl));
        assert.equal(endpoint.protocol, "ws:");
        assert.equal(endpoint.host, new URL(origin).host);
        assert.equal(endpoint.username, "");
        assert.equal(endpoint.password, "");
        assert.equal(endpoint.search, "");
        assert.equal(endpoint.hash, "");
        assert.equal(endpoint.href.includes(token), false);
        return endpoint.href;
      }
      async function discover() {
        const response = await fetch(`${origin}/json/version`, {
          headers: { Authorization: authorization },
        });
        assert.equal(response.headers.get("cache-control"), "no-store");
        return advertisedUrl(await response.json());
      }
      const firstBrowser = await discover();
      assert.equal(await upgrade(firstBrowser, authorization), 101);
      for (const path of ["/json", "/json/list"]) {
        const pages: unknown = await (
          await fetch(origin + path, {
            headers: { Authorization: authorization },
          })
        ).json();
        assert.ok(Array.isArray(pages) && pages.length > 0);
        for (const page of pages)
          assert.equal(await upgrade(advertisedUrl(page), authorization), 101);
      }
      const created: unknown = await (
        await fetch(`${origin}/json/new?about:blank`, {
          method: "PUT",
          headers: { Authorization: authorization },
        })
      ).json();
      assert.equal(await upgrade(advertisedUrl(created), authorization), 101);
      t.diagnostic(
        `Idle browser memory: ${await docker(["stats", "--no-stream", "--format", "{{.MemUsage}}", name])}`,
      );
      const probe = `
const [page]=await (await fetch('http://127.0.0.1:9222/json/list')).json();
const ws=new WebSocket(page.webSocketDebuggerUrl); await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
let id=0;const pending=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}};
const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
if(process.argv[1]==='write') await call('Network.setCookie',{name:'clawscarf_acceptance',value:'retained',url:'https://team-browser.test',expires:Date.now()/1000+3600});
const {cookies}=await call('Network.getAllCookies');
await call('Page.navigate',{url:'chrome://sandbox/'});await new Promise(r=>setTimeout(r,300));
const sandbox=await call('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true});
const fs=await import('node:fs/promises');
const status=await fs.readFile('/proc/self/status','utf8');
console.log(JSON.stringify({uid:process.getuid(),status,retained:cookies.some(c=>c.name==='clawscarf_acceptance'&&c.value==='retained'),sandbox:sandbox.result.value}));ws.close();`;
      const first: unknown = JSON.parse(
        await docker([
          "exec",
          name,
          "node",
          "--input-type=module",
          "-e",
          probe,
          "write",
        ]),
      );
      assert.ok(
        first &&
          typeof first === "object" &&
          "sandbox" in first &&
          typeof first.sandbox === "string",
      );
      assert.ok(
        "uid" in first &&
          first.uid === 1000 &&
          "status" in first &&
          typeof first.status === "string",
      );
      assert.match(first.status, /CapEff:\s+0000000000000000/);
      assert.match(first.status, /NoNewPrivs:\s+1/);
      assert.match(first.sandbox, /PID namespaces\s+Yes/);
      assert.match(first.sandbox, /Network namespaces\s+Yes/);
      assert.match(first.sandbox, /Seccomp-BPF sandbox\s+Yes/);
      await docker(["stop", "-t", "12", name]);
      assert.equal(
        await docker(["inspect", "--format", "{{.State.ExitCode}}", name]),
        "0",
      );
      await docker(["start", name]);
      origin = `http://${await docker(["port", name, "9223/tcp"])}`;
      await ready();
      const nextBrowser = await discover();
      assert.notEqual(
        new URL(nextBrowser).pathname,
        new URL(firstBrowser).pathname,
      );
      assert.equal(await upgrade(nextBrowser, authorization), 101);
      const second: unknown = JSON.parse(
        await docker([
          "exec",
          name,
          "node",
          "--input-type=module",
          "-e",
          probe,
          "read",
        ]),
      );
      assert.ok(
        second &&
          typeof second === "object" &&
          "retained" in second &&
          second.retained === true,
      );
    } finally {
      await docker(["rm", "-f", name]).catch(() => undefined);
      await docker(["volume", "rm", state, secrets]);
    }
  },
);
