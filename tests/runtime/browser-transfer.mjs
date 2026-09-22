// Isolated image fixture. Only the node RPC transport is substituted; Gateway
// upload preparation, controller routes, Chromium and result persistence are real.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import console from "node:console";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const bytes = Buffer.from("ClawScarf browser round trip\n\0\u00ff", "utf8");
const commands = ["browser.proxy", "browser.proxy.upload.v1"];
const mode = process.argv[2];

if (mode === "controller") {
  await fs.writeFile(
    process.env.OPENCLAW_CONFIG_PATH,
    JSON.stringify({
      tools: { exec: { mode: "deny" } },
      plugins: { allow: ["browser"], entries: { browser: { enabled: true } } },
      nodeHost: { browserProxy: { enabled: true, allowProfiles: ["team"] } },
      browser: {
        enabled: true,
        defaultProfile: "team",
        profiles: {
          team: {
            cdpUrl: `http://openclaw:${process.env.FIXTURE_CDP_TOKEN}@browser:9223`,
            attachOnly: true,
          },
        },
        ssrfPolicy: { allowedHostnames: ["browser", "fixture.test"] },
      },
    }),
    { mode: 0o600 },
  );
  const native = await import("/app/dist/extensions/browser/runtime-api.js");
  createServer((request, response) => {
    if (request.url === "/download") {
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="round-trip.bin"',
      });
      response.end(bytes);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      '<!doctype html><input id="upload" type="file"><a id="download" href="/download">Download file</a>',
    );
  }).listen(9001, "0.0.0.0");
  createServer((request, response) => {
    const run = async () => {
      let input = "";
      for await (const part of request) input += part;
      if (!input) {
        response.end("ready");
        return;
      }
      const call = JSON.parse(input);
      if (call.command === "fixture.stop") {
        await native.stopBrowserControlService();
        for (let attempt = 0; attempt < 100; attempt++) {
          const entries = await fs
            .readdir("/browser-artifacts")
            .catch(() => []);
          if (entries.length === 0) {
            response.end(JSON.stringify({ ok: true }));
            return;
          }
          await delay(25);
        }
        throw Error("Connection artifacts were not cleaned up");
      }
      assert.ok(commands.includes(call.command));
      const payloadJSON = await native.runBrowserProxyCommand(
        JSON.stringify(call.params),
        call.command,
      );
      response.end(JSON.stringify({ ok: true, payloadJSON }));
    };
    void run().catch((error) => {
      response.end(
        JSON.stringify({
          ok: false,
          error: { code: "FIXTURE_ERROR", message: String(error) },
        }),
      );
    });
  }).listen(9000, "0.0.0.0");
} else if (mode === "gateway") {
  const { setRuntimeConfigSnapshot } =
    await import("/app/dist/plugin-sdk/runtime-config-snapshot.js");
  setRuntimeConfigSnapshot({
    gateway: {
      nodes: {
        browser: { mode: "manual", node: "fixture-node" },
      },
    },
  });
  const { handleBrowserGatewayRequest } =
    await import("/app/dist/extensions/browser/runtime-api.js");
  const invoke = async (call) => {
    const response = await globalThis.fetch("http://controller:9000", {
      method: "POST",
      body: JSON.stringify(call),
      signal: globalThis.AbortSignal.timeout(45000),
    });
    return await response.json();
  };
  const request = async (method, path, body) => {
    let result, failure;
    await handleBrowserGatewayRequest({
      params: {
        method,
        path,
        body,
        query: { profile: "team" },
        timeoutMs: 20000,
      },
      context: {
        nodeRegistry: {
          listConnected: () => [
            {
              nodeId: "fixture-node",
              connId: "fixture-connection",
              displayName: "Fixture",
              platform: "linux",
              deviceFamily: "Linux",
              caps: ["browser"],
              commands,
            },
          ],
          invoke,
        },
      },
      respond: (ok, value, error) => {
        if (ok) result = value;
        else failure = error;
      },
    });
    if (failure) throw Error(failure.message);
    return result;
  };
  const tab = await request("POST", "/tabs/open", {
    url: "http://fixture.test:9001",
  });
  const targetId = tab.targetId;
  assert.equal(typeof targetId, "string");
  await fs.writeFile("/workspace/upload.bin", bytes);
  await assert.rejects(
    request("POST", "/hooks/file-chooser", {
      targetId,
      element: "#upload",
      paths: ["/workspace/upload.bin"],
    }),
  );
  const inbound = "/state/native/media/inbound";
  await fs.mkdir(inbound, { recursive: true });
  await fs.copyFile("/workspace/upload.bin", `${inbound}/upload.bin`);
  await request("POST", "/hooks/file-chooser", {
    targetId,
    element: "#upload",
    paths: [`${inbound}/upload.bin`],
  });
  const uploaded = await request("POST", "/act", {
    targetId,
    kind: "evaluate",
    fn: "async () => Array.from(new Uint8Array(await document.querySelector('#upload').files[0].arrayBuffer()))",
  });
  assert.deepEqual(Buffer.from(uploaded.result), bytes);
  const downloaded = await request("POST", "/act", {
    targetId,
    kind: "evaluate",
    fn: "() => { document.querySelector('#download').click(); return true; }",
  });
  assert.equal(downloaded.downloads?.length, 1);
  const saved = downloaded.downloads[0].path;
  assert.ok(saved.startsWith("/state/native/media/browser/"), saved);
  assert.deepEqual(await fs.readFile(saved), bytes);
  await fs.copyFile(saved, "/workspace/download.bin");
  assert.deepEqual(
    await fs.readFile("/workspace/download.bin"),
    await fs.readFile("/workspace/upload.bin"),
  );
  await request("DELETE", `/tabs/${targetId}`);
  assert.equal((await invoke({ command: "fixture.stop" })).ok, true);
  console.log(
    JSON.stringify({
      upload: "exact bytes",
      download: "workspace round trip",
      cleanup: "empty",
    }),
  );
} else throw Error("Unknown browser transfer fixture mode");
