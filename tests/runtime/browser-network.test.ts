import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { WebSocket } from "undici";

async function docker(args: string[], input?: string): Promise<string> {
  return await new Promise((accept, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "",
      error = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      error += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? accept(output.trim())
        : reject(new Error(`Docker failed (${code}): ${error}`)),
    );
    child.stdin.end(input);
  });
}
type TestResource = {
  kind: "container" | "volume" | "network";
  name: string;
  state: "pending" | "created" | "removed";
};
async function recordResources(directory: string, resources: TestResource[]) {
  await writeFile(
    join(directory, "resources.json"),
    JSON.stringify(resources, null, 2),
    { mode: 0o600 },
  );
}
async function allocateResource(
  directory: string,
  resources: TestResource[],
  kind: TestResource["kind"],
  name: string,
  args: string[],
  command = docker,
) {
  const resource: TestResource = { kind, name, state: "pending" };
  resources.push(resource);
  await recordResources(directory, resources);
  await command(args);
  resource.state = "created";
  await recordResources(directory, resources);
}
async function cleanupResources(
  directory: string,
  resources: TestResource[],
  command = docker,
) {
  const failures: Error[] = [];
  for (const kind of ["container", "volume", "network"] as const) {
    for (const resource of [...resources]
      .reverse()
      .filter((resource) => resource.kind === kind)) {
      if (resource.state === "removed") continue;
      if (resource.state === "pending") {
        failures.push(
          new Error(
            `Unconfirmed allocation: inspect ${resource.kind} ${resource.name}.`,
          ),
        );
        continue;
      }
      try {
        await command(
          kind === "container"
            ? ["rm", "-f", resource.name]
            : [kind, "rm", resource.name],
        );
        resource.state = "removed";
        await recordResources(directory, resources);
      } catch {
        failures.push(
          new Error(
            `Cleanup did not confirm removal of ${resource.kind} ${resource.name}.`,
          ),
        );
      }
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      `Browser-network cleanup is incomplete. Retained diagnostics: ${directory}`,
    );
  await rm(directory, { recursive: true, force: true });
}
const messageSchema = z.object({
  id: z.number().optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
async function cdp(url: string, authorization: string) {
  const socket = new WebSocket(url, {
    headers: { Authorization: authorization },
  });
  await new Promise<void>((accept, reject) => {
    socket.addEventListener("open", () => accept(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("CDP connection failed")),
      { once: true },
    );
  });
  let sequence = 0;
  const events = new Map<string, (params: unknown) => void>();
  const pending = new Map<
    number,
    { accept: (result: unknown) => void; reject: (error: Error) => void }
  >();
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const value = messageSchema.parse(JSON.parse(event.data));
    if (value.id === undefined) {
      if (value.method) events.get(value.method)?.(value.params);
      return;
    }
    const handler = pending.get(value.id);
    if (!handler) return;
    pending.delete(value.id);
    if (value.error) handler.reject(new Error("CDP command failed"));
    else handler.accept(value.result);
  });
  return {
    async nextEvent(method: string): Promise<unknown> {
      return await new Promise((accept, reject) => {
        const timer = setTimeout(() => {
          events.delete(method);
          reject(new Error(`CDP event ${method} timed out`));
        }, 10000);
        events.set(method, (params) => {
          clearTimeout(timer);
          events.delete(method);
          accept(params);
        });
      });
    },
    async call(
      method: string,
      params: Record<string, unknown> = {},
    ): Promise<unknown> {
      const id = ++sequence;
      return await new Promise((accept, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP ${method} timed out`));
        }, 20000);
        pending.set(id, {
          accept: (result) => {
            clearTimeout(timer);
            accept(result);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}
const address = (ip: string) =>
  ip.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);
async function subnet(): Promise<string> {
  const ids = (await docker(["network", "ls", "-q"])).split(/\s+/);
  const ranges = z
    .array(
      z.object({
        IPAM: z.object({
          Config: z
            .array(z.object({ Subnet: z.string().optional() }))
            .nullable(),
        }),
      }),
    )
    .parse(JSON.parse(await docker(["network", "inspect", ...ids])))
    .flatMap((n) => n.IPAM.Config ?? [])
    .flatMap((c) => (c.Subnet && !c.Subnet.includes(":") ? [c.Subnet] : []));
  for (let octet = 0; octet < 256; octet++) {
    const candidate = `10.234.${octet}.0`,
      lo = address(candidate),
      hi = lo + 255;
    if (
      !ranges.some((range) => {
        const [ip, bits] = range.split("/");
        assert.ok(ip);
        const start = address(ip),
          end = start + 2 ** (32 - Number(bits)) - 1;
        return lo <= end && hi >= start;
      })
    )
      return `${candidate}/24`;
  }
  throw new Error("No unused test subnet");
}
const browserImage = process.env.CLAWSCARF_TEST_BROWSER_IMAGE;
const egressImage = process.env.CLAWSCARF_TEST_BROWSER_EGRESS_IMAGE;
const relayImage = process.env.CLAWSCARF_TEST_BROWSER_RELAY_IMAGE;
await test(
  "browser network permits public browsing and denies host/private destinations",
  { skip: !browserImage || !egressImage || !relayImage, timeout: 180000 },
  async (t) => {
    assert.ok(browserImage && egressImage && relayImage);
    const prefix = `cs-browser-network-${randomUUID()}`,
      network = `${prefix}-network`,
      runtimeNetwork = `${prefix}-runtime`;
    const browser = `${prefix}-browser`,
      proxy = `${prefix}-proxy`,
      relay = `${prefix}-relay`;
    const state = `${prefix}-state`,
      secrets = `${prefix}-secrets`;
    const directory = await mkdtemp(
      join(tmpdir(), "clawscarf-browser-network-"),
    );
    const resources: TestResource[] = [];
    const cidr = await subnet(),
      browserIp = cidr.replace(".0/24", ".2"),
      proxyIp = cidr.replace(".0/24", ".3"),
      relayIp = cidr.replace(".0/24", ".4");
    const token = randomBytes(32).toString("hex"),
      authorization = `Bearer ${token}`;
    const baseline = createServer((socket) => socket.end("host-baseline"));
    await new Promise<void>((accept) => baseline.listen(0, "0.0.0.0", accept));
    const listener = baseline.address();
    assert.ok(listener && typeof listener !== "string");
    const socketProbe =
      'const s=require("net").connect({host:process.argv[1],port:Number(process.argv[2])});s.setTimeout(2000);s.on("data",d=>console.log(d.toString()));s.on("error",e=>console.log(e.code));s.on("timeout",()=>{console.log("TIMEOUT");s.destroy()});';
    try {
      const hostIp = await docker([
        "run",
        "--rm",
        "--add-host",
        "host.docker.internal:host-gateway",
        "--entrypoint",
        "node",
        browserImage,
        "-e",
        'require("dns").lookup("host.docker.internal",{family:4},(e,a)=>{if(e)process.exit(1);console.log(a)})',
      ]);
      assert.equal(
        await docker([
          "run",
          "--rm",
          "--add-host",
          "host.docker.internal:host-gateway",
          "--entrypoint",
          "node",
          browserImage,
          "-e",
          socketProbe,
          hostIp,
          String(listener.port),
        ]),
        "host-baseline",
      );
      await writeFile(
        join(directory, "browser-source.acl"),
        `${browserIp}/32\n`,
      );
      await allocateResource(directory, resources, "network", network, [
        "network",
        "create",
        "--internal",
        "--subnet",
        cidr,
        "-o",
        "com.docker.network.bridge.gateway_mode_ipv4=isolated",
        network,
      ]);
      const runtimeCidr = await subnet();
      const runtimeRelayIp = runtimeCidr.replace(".0/24", ".2");
      await allocateResource(directory, resources, "network", runtimeNetwork, [
        "network",
        "create",
        "--subnet",
        runtimeCidr,
        runtimeNetwork,
      ]);
      await allocateResource(directory, resources, "volume", state, [
        "volume",
        "create",
        state,
      ]);
      await allocateResource(directory, resources, "volume", secrets, [
        "volume",
        "create",
        secrets,
      ]);
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
          "-v",
          `${state}:/state`,
          "-v",
          `${secrets}:/secrets`,
          "--entrypoint",
          "node",
          browserImage,
          "-e",
          'const fs=require("fs");let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{fs.writeFileSync("/secrets/token",s,{mode:0o600});fs.chownSync("/secrets/token",1000,1000);fs.chownSync("/state",1000,1000)})',
        ],
        token,
      );
      const hardened = [
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=64m",
      ];
      await allocateResource(directory, resources, "container", proxy, [
        "run",
        "-d",
        "--name",
        proxy,
        "--network",
        "bridge",
        ...hardened,
        "--add-host",
        `private.test:${hostIp}`,
        "--add-host",
        "mixed.test:93.184.215.14",
        "--add-host",
        `mixed.test:${hostIp}`,
        "--mount",
        `type=bind,source=${directory}/browser-source.acl,target=/etc/squid/browser-source.acl,readonly`,
        egressImage,
      ]);
      await docker([
        "network",
        "connect",
        "--ip",
        proxyIp,
        "--alias",
        "browser-egress",
        network,
        proxy,
      ]);
      await writeFile(join(directory, "haproxy.cfg"), "");
      await allocateResource(directory, resources, "container", relay, [
        "create",
        "--name",
        relay,
        "--network",
        runtimeNetwork,
        "--ip",
        runtimeRelayIp,
        ...hardened,
        "-p",
        "127.0.0.1::9223",
        "--mount",
        `type=bind,source=${directory}/haproxy.cfg,target=/usr/local/etc/haproxy/haproxy.cfg,readonly`,
        relayImage,
      ]);
      await docker(["network", "connect", "--ip", relayIp, network, relay]);
      await writeFile(
        join(directory, "haproxy.cfg"),
        `global
  maxconn 32

defaults
  mode tcp
  timeout connect 5s
  timeout client 1h
  timeout server 1h

resolvers docker
  nameserver docker 127.0.0.11:53
  timeout resolve 1s
  timeout retry 1s
  hold valid 1s

listen browser
  bind :9223
  server browser browser:9223 resolvers docker init-addr libc,none

listen execution
  bind ${runtimeRelayIp}:2222
  server worker ${hostIp}:${String(listener.port)}
`,
      );
      await docker(["start", relay]);
      assert.equal(
        await docker([
          "run",
          "--rm",
          "--network",
          runtimeNetwork,
          "--entrypoint",
          "node",
          browserImage,
          "-e",
          socketProbe,
          runtimeRelayIp,
          "2222",
        ]),
        "host-baseline",
        "SSH relay preserves the fixed upstream byte stream",
      );
      await allocateResource(directory, resources, "container", browser, [
        "run",
        "-d",
        "--name",
        browser,
        "--network",
        network,
        "--network-alias",
        "browser",
        "--ip",
        browserIp,
        "--init",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--security-opt",
        `seccomp=${resolve("deploy/execution/browser/seccomp.json")}`,
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=512m",
        "--shm-size=256m",
        "--memory=1g",
        "--pids-limit=256",
        "-v",
        `${state}:/state`,
        "-v",
        `${secrets}:/secrets:ro`,
        "-e",
        "CLAWSCARF_BROWSER_TOKEN_FILE=/secrets/token",
        "-e",
        "CLAWSCARF_BROWSER_PROXY_SERVER=http://browser-egress:3128",
        browserImage,
      ]);
      const origin = `http://${await docker(["port", relay, "9223/tcp"])}`;
      async function ready() {
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            const response = await fetch(`${origin}/json/version`, {
              headers: { Authorization: authorization },
              signal: AbortSignal.timeout(500),
            });
            await response.body?.cancel();
            if (response.ok) return;
          } catch {
            /* Startup observation only. */
          }
          await delay(100);
        }
        throw new Error("Browser did not become ready");
      }
      await ready();
      for (const auth of ["", "Bearer wrong"]) {
        const response = await fetch(`${origin}/json/version`, {
          headers: { Authorization: auth },
        });
        assert.equal(response.status, 401);
        await response.body?.cancel();
        await assert.rejects(
          cdp(`${origin.replace("http", "ws")}/devtools/browser/invalid`, auth),
        );
      }
      for (const [ip, port] of [
        [hostIp, listener.port],
        ["169.254.169.254", 80],
        ["1.1.1.1", 443],
      ] as const)
        assert.equal(
          await docker([
            "exec",
            browser,
            "node",
            "-e",
            socketProbe,
            ip,
            String(port),
          ]),
          "ENETUNREACH",
        );
      assert.equal(
        await docker([
          "exec",
          browser,
          "node",
          "-e",
          socketProbe,
          relayIp,
          "2222",
        ]),
        "ECONNREFUSED",
      );
      const proxyRequest =
        'const http=require("http");const req=http.request({host:process.argv[1],port:Number(process.argv[2]),method:process.argv[3],path:process.argv[4]},res=>{console.log(res.statusCode);res.resume()});req.on("connect",(res,s)=>{console.log(res.statusCode);s.destroy()});req.on("error",()=>console.log("CONNECTION_CLOSED"));req.setTimeout(10000,()=>req.destroy());req.end();';
      for (const url of [
        "http://127.0.0.1",
        "http://private.test",
        "http://mixed.test",
        "http://169.254.169.254",
        "http://[::1]",
        "http://[fe80::1]",
        "http://[fc00::1]",
        "http://[ff02::1]",
        "http://[2001:db8::1]",
        "http://[::ffff:127.0.0.1]",
        "http://224.0.0.1",
        "http://does-not-exist.invalid",
        "http://example.com:8080",
      ])
        assert.equal(
          await docker([
            "exec",
            browser,
            "node",
            "-e",
            proxyRequest,
            proxyIp,
            "3128",
            "GET",
            url,
          ]),
          "403",
          url,
        );
      assert.equal(
        await docker([
          "exec",
          browser,
          "node",
          "-e",
          proxyRequest,
          relayIp,
          "9223",
          "CONNECT",
          "example.com:443",
        ]),
        "CONNECTION_CLOSED",
      );
      assert.equal(
        await docker([
          "exec",
          proxy,
          "node",
          "-e",
          proxyRequest,
          proxyIp,
          "3128",
          "GET",
          "https://example.com",
        ]),
        "403",
      );
      assert.equal(
        await docker([
          "exec",
          browser,
          "node",
          "-e",
          proxyRequest,
          relayIp,
          "9223",
          "GET",
          `http://${hostIp}:${listener.port}`,
        ]),
        "401",
      );
      for (const name of [browser, relay, proxy]) {
        const status = await docker(["exec", name, "cat", "/proc/1/status"]);
        assert.match(status, /CapEff:\s+0000000000000000/);
        assert.match(status, /NoNewPrivs:\s+1/);
      }
      const pageSchema = z.object({ webSocketDebuggerUrl: z.string() });
      function advertisedUrl(value: unknown) {
        const endpoint = new URL(pageSchema.parse(value).webSocketDebuggerUrl);
        assert.equal(endpoint.protocol, "ws:");
        assert.equal(endpoint.host, new URL(origin).host);
        assert.equal(endpoint.username, "");
        assert.equal(endpoint.password, "");
        assert.equal(endpoint.search, "");
        return endpoint.href;
      }
      async function browserEndpoint() {
        return advertisedUrl(
          await (
            await fetch(`${origin}/json/version`, {
              headers: { Authorization: authorization },
            })
          ).json(),
        );
      }
      const initialBrowser = await browserEndpoint();
      const browserClient = await cdp(initialBrowser, authorization);
      await browserClient.call("Browser.getVersion");
      browserClient.close();
      async function pageClient() {
        const page = pageSchema.parse(
          await (
            await fetch(`${origin}/json/new?about:blank`, {
              method: "PUT",
              headers: { Authorization: authorization },
            })
          ).json(),
        );
        return await cdp(advertisedUrl(page), authorization);
      }
      const client = await pageClient();
      try {
        await client.call("Page.navigate", { url: "https://example.com" });
        let content = "";
        for (let attempt = 0; attempt < 100; attempt++) {
          const value = z
            .object({ result: z.object({ value: z.string() }) })
            .parse(
              await client.call("Runtime.evaluate", {
                expression: "document.body?.innerText ?? ''",
                returnByValue: true,
              }),
            );
          content = value.result.value;
          if (content.includes("Example Domain")) break;
          await delay(100);
        }
        assert.match(content, /Example Domain/);
        await client.call("Network.setCookie", {
          name: "network_acceptance",
          value: "retained",
          url: "https://example.com",
          expires: Date.now() / 1000 + 3600,
        });
        await client.call("Page.navigate", { url: "http://private.test" });
        await delay(500);
        const denied = z
          .object({ result: z.object({ value: z.string() }) })
          .parse(
            await client.call("Runtime.evaluate", {
              expression: "document.body?.innerText ?? ''",
              returnByValue: true,
            }),
          );
        assert.match(denied.result.value, /Access Denied|ERR_ACCESS_DENIED/);
        // Inject only the public redirect response; Chromium follows its real private target through Squid.
        const redirectUrl = "https://example.com/clawscarf-network-redirect";
        await client.call("Fetch.enable", {
          patterns: [{ urlPattern: redirectUrl }],
        });
        const paused = client.nextEvent("Fetch.requestPaused");
        const navigation = client.call("Page.navigate", { url: redirectUrl });
        const request = z.object({ requestId: z.string() }).parse(await paused);
        await client.call("Fetch.fulfillRequest", {
          requestId: request.requestId,
          responseCode: 302,
          responseHeaders: [{ name: "Location", value: "http://127.0.0.1" }],
        });
        await navigation;
        await client.call("Fetch.disable");
        let redirected = "";
        for (let attempt = 0; attempt < 100; attempt++) {
          const result = z
            .object({ result: z.object({ value: z.string() }) })
            .parse(
              await client.call("Runtime.evaluate", {
                expression: "document.body?.innerText ?? ''",
                returnByValue: true,
              }),
            );
          redirected = result.result.value;
          if (/Access Denied|ERR_ACCESS_DENIED/.test(redirected)) break;
          await delay(100);
        }
        assert.match(redirected, /Access Denied|ERR_ACCESS_DENIED/);
      } finally {
        client.close();
      }
      await docker(["stop", "-t", "12", browser]);
      await docker(["start", browser]);
      await ready();
      const nextBrowser = await browserEndpoint();
      assert.notEqual(
        new URL(nextBrowser).pathname,
        new URL(initialBrowser).pathname,
      );
      const resumedBrowser = await cdp(nextBrowser, authorization);
      await resumedBrowser.call("Browser.getVersion");
      resumedBrowser.close();
      const resumed = await pageClient();
      try {
        const result = z
          .object({
            cookies: z.array(z.object({ name: z.string(), value: z.string() })),
          })
          .parse(await resumed.call("Network.getAllCookies"));
        assert.ok(
          result.cookies.some(
            (cookie) =>
              cookie.name === "network_acceptance" &&
              cookie.value === "retained",
          ),
        );
      } finally {
        resumed.close();
      }
      t.diagnostic(
        "Actual Chromium: public HTTPS, retained profile, authenticated CDP; private/mixed DNS and numeric host/metadata denied.",
      );
    } finally {
      baseline.close();
      await cleanupResources(directory, resources);
    }
  },
);

await test("browser-network cleanup reports failures, retains private evidence and attempts each confirmed resource once", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-network-cleanup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const resources: TestResource[] = [];
  const calls: string[][] = [];
  let failVolume = true;
  const command: typeof docker = (args) => {
    calls.push([...args]);
    if (args[0] === "volume" && args[1] === "rm" && failVolume)
      return Promise.reject(
        Error("Sensitive Docker diagnostics must not escape"),
      );
    return Promise.resolve("");
  };
  for (const kind of ["network", "volume", "container"] as const)
    await allocateResource(
      directory,
      resources,
      kind,
      `test-${kind}`,
      [kind, "create", `test-${kind}`],
      command,
    );
  calls.length = 0;
  await assert.rejects(
    cleanupResources(directory, resources, command),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /Retained diagnostics/);
      assert.equal(error.errors.length, 1);
      const detail: unknown = error.errors[0];
      assert.ok(detail instanceof Error);
      assert.match(detail.message, /test-volume/);
      assert.equal(detail.message.includes("Sensitive"), false);
      return true;
    },
  );
  assert.deepEqual(calls, [
    ["rm", "-f", "test-container"],
    ["volume", "rm", "test-volume"],
    ["network", "rm", "test-network"],
  ]);
  assert.equal(
    (await stat(join(directory, "resources.json"))).mode & 0o777,
    0o600,
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "resources.json"), "utf8")),
    resources,
  );
  assert.equal(
    resources.find((resource) => resource.kind === "volume")?.state,
    "created",
  );
  failVolume = false;
  calls.length = 0;
  await cleanupResources(directory, resources, command);
  assert.deepEqual(calls, [["volume", "rm", "test-volume"]]);
  await assert.rejects(stat(directory), { code: "ENOENT" });
});

await test("uncertain browser-network allocation is retained for inspection instead of deleted or retried", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "clawscarf-network-uncertain-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const resources: TestResource[] = [];
  let calls = 0;
  const command: typeof docker = () => {
    calls++;
    return Promise.reject(Error("Allocation response lost"));
  };
  await assert.rejects(
    allocateResource(
      directory,
      resources,
      "network",
      "uncertain-network",
      ["network", "create", "uncertain-network"],
      command,
    ),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    cleanupResources(directory, resources, command),
    AggregateError,
  );
  assert.equal(calls, 1);
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "resources.json"), "utf8")),
    [{ kind: "network", name: "uncertain-network", state: "pending" }],
  );
});
