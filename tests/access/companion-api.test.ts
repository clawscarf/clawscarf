import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { createIngress } from "../../services/access/providers/ingress.js";
import { AccessError } from "../../services/access/types/errors.js";

const prefix = "/_clawscarf/example/v1/runtime/";
await test("companion API is confined to its management TLS Host and prefix without rewriting credentials or opening native routes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-companion-tls-"));
  const native = createServer((_req, res) => {
    nativeRequests++;
    res.end("native");
  });
  let nativeRequests = 0;
  native.listen(0, "127.0.0.1");
  await once(native, "listening");
  const nativeAddress = native.address();
  assert.ok(nativeAddress && typeof nativeAddress !== "string");
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const reserved = reservation.address();
  assert.ok(reserved && typeof reserved !== "string");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const apiOrigin = `https://127.0.0.1:${String(reserved.port)}`;
  let ingress: ReturnType<typeof createIngress> | undefined;
  try {
    await promisify(execFile)("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "ca.pem"),
    ]);
    const cert = await readFile(join(directory, "ca.pem"));
    const key = await readFile(join(directory, "key.pem"));
    const observed: {
      path: string | undefined;
      headers: IncomingHttpHeaders;
    }[] = [];
    const build = (enabled: boolean) =>
      createIngress(
        {
          authenticate: (session) => {
            if (session !== "human")
              throw new AccessError("unauthenticated", "Sign in");
            return Promise.resolve({ identity: "clawscarf:human" });
          },
        },
        [
          {
            kind: "application",
            origin: "http://127.0.0.1:18800",
            upstream: `http://127.0.0.1:${String(nativeAddress.port)}`,
          },
        ],
        true,
        (req, res) => {
          observed.push({ path: req.url, headers: { ...req.headers } });
          res.end("companion");
        },
        { management: { cert, key } },
        enabled ? { origin: apiOrigin, pathPrefix: prefix } : undefined,
      );
    ingress = build(true);
    assert.ok(ingress.managementServer);
    ingress.managementServer.listen(reserved.port, "127.0.0.1");
    ingress.server.listen(0, "127.0.0.1");
    await Promise.all([
      once(ingress.managementServer, "listening"),
      once(ingress.server, "listening"),
    ]);
    const appAddress = ingress.server.address();
    assert.ok(appAddress && typeof appAddress !== "string");
    const read = (
      path: string,
      headers: IncomingHttpHeaders = {},
      application = false,
    ) =>
      new Promise<{ status: number | undefined; body: string }>(
        (resolve, reject) => {
          const request = application ? httpRequest : httpsRequest;
          const req = request(
            {
              hostname: "127.0.0.1",
              port: application ? appAddress.port : reserved.port,
              path,
              headers,
              ca: cert,
              agent: false,
              servername: "localhost",
            },
            (res) => {
              let body = "";
              res.setEncoding("utf8");
              res.on("data", (chunk: string) => {
                body += chunk;
              });
              res.on("end", () => resolve({ status: res.statusCode, body }));
            },
          );
          req.on("error", (error) =>
            reject(new Error(`Request failed: ${path}`, { cause: error })),
          );
          req.end();
        },
      );
    assert.equal(
      (
        await read(prefix + "search?limit=5", {
          authorization: "Bearer scoped",
          cookie: "clawscarf_session=human",
          "x-openclaw-user": "forged",
        })
      ).status,
      200,
    );
    assert.equal(observed[0]?.headers.authorization, "Bearer scoped");
    assert.equal(
      observed[0]?.headers.cookie,
      "clawscarf_session=human",
      "The runtime authentication owner must reject mixed credentials itself",
    );
    assert.equal(observed[0]?.path, prefix + "search?limit=5");
    for (const path of [
      "/",
      "/healthz",
      "/hooks/wake",
      "/_clawscarf/session",
      "/_clawscarf/local-login",
      prefix.slice(0, -1),
      prefix.slice(0, -1) + "-other/search",
      prefix + "../../session",
      "//elsewhere.test/",
      prefix + "%2e%2e/secret",
    ])
      assert.equal((await read(path)).status, 403, path);
    assert.equal(
      (await read(prefix + "search", { host: "unknown.invalid" })).status,
      403,
    );
    assert.equal(
      (await read(prefix + "search", { host: new URL(apiOrigin).host }, true))
        .status,
      403,
    );
    assert.equal(
      (
        await read(prefix + "search", {
          connection: "Upgrade",
          upgrade: "websocket",
        })
      ).status,
      403,
    );
    assert.equal(observed.length, 1);
    assert.equal(nativeRequests, 0);
    // Existing acting-human clients deliberately use the application Host on management TLS.
    assert.equal(
      (
        await read("/", {
          host: "127.0.0.1:18800",
          cookie: "clawscarf_session=human",
        })
      ).body,
      "native",
    );
    assert.equal(nativeRequests, 1);
    assert.equal((await read("/", { host: "127.0.0.1:18800" })).status, 401);
    await ingress.close();
    ingress = build(false);
    assert.ok(ingress.managementServer);
    ingress.managementServer.listen(reserved.port, "127.0.0.1");
    await once(ingress.managementServer, "listening");
    assert.equal((await read(prefix + "search")).status, 403);
    assert.equal(observed.length, 1);
  } finally {
    await ingress?.close();
    await new Promise<void>((resolve) => native.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

await test("companion API composition rejects insecure, colliding and noncanonical origins or prefixes", () => {
  const application = {
    kind: "application" as const,
    origin: "https://app.example",
    upstream: "http://127.0.0.1:9",
  };
  for (const route of [
    { origin: "http://broker.example", pathPrefix: prefix },
    { origin: "https://app.example", pathPrefix: prefix },
    { origin: "https://user:secret@broker.example", pathPrefix: prefix },
    { origin: "https://broker.example/path", pathPrefix: prefix },
    { origin: "https://broker.example", pathPrefix: "/" },
    { origin: "https://broker.example", pathPrefix: prefix + "../" },
    { origin: "https://broker.example", pathPrefix: prefix + "?other=/" },
  ])
    assert.throws(() =>
      createIngress(
        { authenticate: () => Promise.resolve({ identity: "test" }) },
        [application],
        false,
        () => {},
        { management: {} },
        route,
      ),
    );
  assert.throws(() =>
    createIngress(
      { authenticate: () => Promise.resolve({ identity: "test" }) },
      [application],
      false,
      () => {},
      {},
      { origin: "https://broker.example", pathPrefix: prefix },
    ),
  );
});
