import { readPrivateFile } from "../../../runtime/private-files.js";
import { spawn, type ChildProcess } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { createProxyServer } from "httpxy";
import { mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import {
  chromeOrigin,
  discoveryRequest,
  writeDiscoveryResponse,
  type DiscoveryRequest,
} from "./discovery.js";
const tokenFile = process.env.CLAWSCARF_BROWSER_TOKEN_FILE;
if (!tokenFile) throw new Error("CLAWSCARF_BROWSER_TOKEN_FILE is required");
const token = (await readPrivateFile(tokenFile, 4096)).toString("utf8").trim();
if (token.length < 32 || /\s/.test(token)) {
  throw new Error(
    "Browser credential requires a private file and at least 32 non-whitespace characters",
  );
}
await mkdir(process.env.HOME ?? "/tmp/browser-home", {
  recursive: true,
  mode: 0o700,
});
const args = [
  "--headless",
  "--no-first-run",
  "--no-default-browser-check",
  "--user-data-dir=/state",
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=9222",
  "--disable-background-networking",
  "about:blank",
];
const proxy = process.env.CLAWSCARF_BROWSER_PROXY_SERVER;
if (proxy) {
  let url: URL;
  try {
    url = new URL(proxy);
  } catch {
    throw new Error("Browser proxy must be a valid HTTP origin");
  }
  if (
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Browser proxy must be an HTTP origin without credentials");
  }
  args.unshift(
    `--proxy-server=${url.origin}`,
    "--proxy-bypass-list=<-loopback>",
  );
}
const chrome = spawn("/usr/bin/chromium", args, {
  stdio: ["ignore", "ignore", "ignore"],
});
const expectedAuth = [
  Buffer.from(`Bearer ${token}`),
  Buffer.from(`Basic ${Buffer.from(`openclaw:${token}`).toString("base64")}`),
];
function authorized(req: IncomingMessage): boolean {
  const value = Buffer.from(req.headers.authorization ?? "");
  return (
    expectedAuth.some(
      (expected) =>
        value.length === expected.length && timingSafeEqual(value, expected),
    ) && req.url?.startsWith("/") === true
  );
}
const sockets = new Set<Socket>();
const proxyServer = createProxyServer({
  target: chromeOrigin,
  changeOrigin: true,
  xfwd: false,
  proxyTimeout: 0,
  timeout: 0,
  followRedirects: false,
});
const discovery = new WeakMap<IncomingMessage, DiscoveryRequest>();
proxyServer.on("proxyRes", (upstream, request, response) => {
  const rewrite = discovery.get(request);
  if (!rewrite) return;
  void writeDiscoveryResponse(upstream, response, rewrite).catch(() => {
    if (!response.destroyed && !response.headersSent) {
      response.writeHead(502, { "Cache-Control": "no-store" });
      response.end();
    } else response.destroy();
    upstream.destroy();
  });
});
const server = createServer((req, res) => {
  if (req.headers.origin !== undefined) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!authorized(req)) {
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="ClawScarf browser"',
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }
  let rewrite: DiscoveryRequest | undefined;
  try {
    rewrite = discoveryRequest(req);
  } catch {
    res.writeHead(400, { "Cache-Control": "no-store" });
    res.end();
    return;
  }
  if (rewrite) discovery.set(req, rewrite);
  delete req.headers.authorization;
  void proxyServer
    .web(
      req,
      res,
      rewrite
        ? {
            selfHandleResponse: true,
            proxyTimeout: 5000,
            headers: { "accept-encoding": "identity" },
          }
        : {},
    )
    .catch(() => {
      if (!res.headersSent) {
        res.writeHead(502);
        res.end();
      } else res.destroy();
    });
});
server.headersTimeout = 5000;
server.requestTimeout = 15000;
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});
server.on("upgrade", (req, socket, head) => {
  if (!(socket instanceof Socket)) {
    socket.destroy();
    return;
  }
  if (req.headers.origin !== undefined) {
    socket.end(
      "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
    return;
  }
  if (!authorized(req)) {
    socket.end(
      "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
    return;
  }
  delete req.headers.authorization;
  void proxyServer.ws(req, socket, {}, head).catch(() => socket.destroy());
});
let stopping = false;

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
async function waitExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!exited(child) && Date.now() < deadline) await delay(50);
  return exited(child);
}
async function closeBrowser(): Promise<void> {
  const response = await fetch(`${chromeOrigin}/json/version`, {
    signal: AbortSignal.timeout(2000),
  });
  const info: unknown = await response.json();
  if (
    !info ||
    typeof info !== "object" ||
    !("webSocketDebuggerUrl" in info) ||
    typeof info.webSocketDebuggerUrl !== "string"
  ) {
    throw new Error("Browser has no control endpoint");
  }
  const endpoint = new URL(info.webSocketDebuggerUrl);
  if (
    endpoint.protocol !== "ws:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.port !== "9222"
  ) {
    throw new Error("Browser control endpoint is invalid");
  }
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Browser close timed out"));
    }, 2000);
    const done = () => {
      clearTimeout(timer);
      socket.close();
      resolve();
    };
    socket.addEventListener(
      "open",
      () => socket.send(JSON.stringify({ id: 1, method: "Browser.close" })),
      { once: true },
    );
    socket.addEventListener("message", done, { once: true });
    socket.addEventListener("close", done, { once: true });
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Browser control unavailable"));
      },
      { once: true },
    );
  });
}
async function stop(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  server.close();
  for (const socket of sockets) socket.destroy();
  if (!exited(chrome)) {
    try {
      await closeBrowser();
    } catch {
      console.error("Browser graceful shutdown unavailable");
    }
    if (!(await waitExit(chrome, 5000))) chrome.kill("SIGTERM");
    if (!(await waitExit(chrome, 2000))) chrome.kill("SIGKILL");
    await waitExit(chrome, 1000);
  }
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void stop(0);
  });
chrome.once("error", () => {
  console.error("Browser could not start");
  void stop(1);
});
chrome.once("exit", () => {
  if (!stopping) {
    console.error("Browser exited");
    void stop(1);
  }
});
const deadline = Date.now() + 15000;
let ready = false;
while (!stopping && Date.now() < deadline) {
  try {
    const response = await fetch(`${chromeOrigin}/json/version`, {
      signal: AbortSignal.timeout(500),
    });
    ready = response.ok;
    await response.body?.cancel();
  } catch {
    /* Startup has a bounded readiness deadline. */
  }
  if (ready) break;
  await delay(100);
}
if (!stopping && !ready) {
  console.error("Browser did not become ready");
  await stop(1);
} else if (!stopping) {
  server.once("error", () => {
    console.error("Browser proxy could not start");
    void stop(1);
  });
  server.listen(9223, "0.0.0.0");
}
