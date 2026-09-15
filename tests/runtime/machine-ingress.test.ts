import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const image = process.env.CLAWSCARF_TEST_BROWSER_RELAY_IMAGE;

await test(
  "private node ingress preserves native upgrades without trusted user attribution",
  { skip: !image, timeout: 90_000 },
  async (t) => {
    assert.ok(image);
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-node-ingress-"));
    const name = `cs-node-ingress-${randomUUID().slice(0, 12)}`;
    const seen: IncomingHttpHeaders[] = [];
    const upstream = createServer((_request, response) =>
      response.writeHead(418).end(),
    );
    upstream.on("upgrade", (incoming, socket) => {
      seen.push(incoming.headers);
      const accept = createHash("sha1")
        .update(
          String(incoming.headers["sec-websocket-key"]) +
            "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
        )
        .digest("base64");
      socket.end(
        `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "0.0.0.0", resolve),
    );
    const address = upstream.address();
    assert.ok(address && typeof address !== "string");
    t.after(async () => {
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      );
      try {
        const names = await execute(
          "docker",
          ["container", "ls", "--all", "--format", "{{.Names}}"],
          { timeout: 15_000 },
        );
        if (names.stdout.split("\n").includes(name))
          await execute("docker", ["rm", "--force", name], { timeout: 30_000 });
        await rm(directory, { recursive: true, force: true });
      } catch {
        throw new Error(
          `Node ingress cleanup incomplete; inspect ${name}. Private fixtures retained at ${directory}.`,
        );
      }
    });
    await execute(
      "openssl",
      [
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
        join(directory, "server.pem"),
        "-out",
        join(directory, "cert.pem"),
      ],
      { timeout: 15_000 },
    );
    await appendFile(
      join(directory, "server.pem"),
      await readFile(join(directory, "cert.pem")),
    );
    await chmod(join(directory, "server.pem"), 0o600);
    const uid = process.getuid?.();
    assert.ok(
      uid && uid > 0,
      "Run this local component fixture as a nonroot operator.",
    );
    await execute(
      "docker",
      [
        "run",
        "--detach",
        "--name",
        name,
        "--pull",
        "never",
        "--network",
        "bridge",
        "--add-host",
        "host.docker.internal:host-gateway",
        "--user",
        String(uid),
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--memory",
        "64m",
        "--pids-limit",
        "64",
        "--publish",
        "127.0.0.1::18803",
        "--env",
        "CLAWSCARF_NODE_INGRESS_ADDRESS=0.0.0.0",
        "--env",
        `CLAWSCARF_NODE_GATEWAY_PORT=${String(address.port)}`,
        "--mount",
        `type=bind,source=${join(directory, "server.pem")},target=/run/clawscarf/node-ingress.pem,readonly`,
        "--mount",
        `type=bind,source=${resolve("deploy/execution/network/node-ingress.cfg")},target=/usr/local/etc/haproxy/haproxy.cfg,readonly`,
        image,
      ],
      { timeout: 15_000 },
    );
    const published = await execute("docker", ["port", name, "18803/tcp"], {
      timeout: 10_000,
    });
    const match = /^127\.0\.0\.1:(\d+)\s*$/u.exec(published.stdout);
    assert.ok(match);
    const port = Number(match[1]);
    const ca = await readFile(join(directory, "cert.pem"));
    const send = (headers: Record<string, string> = {}, path = "/") =>
      new Promise<number>((resolve, reject) => {
        const outgoing = request({
          hostname: "127.0.0.1",
          port,
          path,
          ca,
          headers,
          timeout: 3000,
        });
        outgoing.on("response", (incoming) => {
          incoming.resume();
          resolve(incoming.statusCode ?? 0);
        });
        outgoing.on("upgrade", (incoming, socket) => {
          socket.destroy();
          resolve(incoming.statusCode ?? 0);
        });
        outgoing.on("timeout", () =>
          outgoing.destroy(new Error("Ingress request timed out.")),
        );
        outgoing.on("error", reject);
        outgoing.end();
      });
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        ready = (await send()) === 404;
      } catch {
        /* The new listener is still starting. */
      }
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, "The TLS machine ingress did not start.");
    const upgrade = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
    };
    assert.equal(await send(upgrade, "/api/v1/admin/rpc"), 404);
    assert.equal(
      await send({ ...upgrade, Origin: "https://attacker.example" }),
      403,
    );
    assert.equal(seen.length, 0);
    assert.equal(
      await send({
        ...upgrade,
        "X-OpenClaw-User": "administrator",
        "x-OPENCLAW-scopes": "operator.admin",
        "X-Forwarded-For": "127.0.0.1",
        "x-FORWARDED-proto": "https",
        Forwarded: "for=127.0.0.1",
        "X-Real-IP": "127.0.0.1",
        "Remote-User": "administrator",
        Authorization: "Bearer unrelated-credential",
        Cookie: "session=unrelated-session",
        "Sec-WebSocket-Protocol": "native-test",
      }),
      101,
    );
    assert.equal(seen.length, 1);
    const forwarded = seen[0];
    assert.ok(forwarded);
    for (const key of Object.keys(forwarded))
      assert.equal(
        /^(?:x-openclaw-|x-forwarded-|forwarded$|x-real-ip$|remote-user$|authorization$|cookie$)/iu.test(
          key,
        ),
        false,
        key,
      );
    assert.equal(forwarded["sec-websocket-protocol"], "native-test");
  },
);
