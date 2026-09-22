import assert from "node:assert/strict";
import { test, before, after, describe } from "node:test";
import { createServer } from "node:https";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setImmediate } from "node:timers/promises";
import { WebSocketServer } from "ws";
import { z } from "zod";
import application from "../../package.json" with { type: "json" };
import { withGateway } from "../../services/access/providers/gateway.js";
import { NativeFailure } from "../../services/access/types/native-errors.js";

await describe("Gateway mutation outcomes", async () => {
  let directory: string;
  let certificate: string;
  let privateKey: string;
  const originalCertificates = getCACertificates("default");
  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "clawscarf-gateway-rejections-"));
    await writeFile(
      join(directory, "tls.cnf"),
      "[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=localhost\n[extensions]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,digitalSignature,keyEncipherment\n",
    );
    await promisify(execFile)("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-config",
      join(directory, "tls.cnf"),
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "ca.pem"),
    ]);
    certificate = await readFile(join(directory, "ca.pem"), "utf8");
    privateKey = await readFile(join(directory, "key.pem"), "utf8");
    setDefaultCACertificates([...originalCertificates, certificate]);
  });
  after(async () => {
    setDefaultCACertificates(originalCertificates);
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  const frame = z.object({
    type: z.literal("req"),
    id: z.string(),
    method: z.string(),
    params: z.unknown().optional(),
  });
  type Reply = { code: string } | "disconnect" | "success" | "restart" | "hot";
  async function gatewayFixture(replies: Reply[]) {
    const listener = createServer({ cert: certificate, key: privateKey });
    const server = new WebSocketServer({ server: listener });
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const address = listener.address();
    assert.ok(address && typeof address !== "string");
    const methods: string[] = [];
    const acknowledged = Promise.withResolvers<void>();
    const reconnected = Promise.withResolvers<void>();
    let connections = 0;
    let administratorProbes = 0;
    server.on("connection", (socket) => {
      socket.send(
        JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "fixture", ts: Date.now() },
        }),
      );
      socket.on("message", (raw) => {
        const bytes = Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.isBuffer(raw)
            ? raw
            : Buffer.from(raw);
        const request = frame.parse(JSON.parse(bytes.toString("utf8")));
        if (request.method === "connect") {
          if (++connections === 2) reconnected.resolve();
          const handshake = z
            .object({
              client: z.object({
                id: z.string(),
                version: z.string(),
                mode: z.string(),
              }),
            })
            .parse(request.params);
          assert.deepEqual(handshake.client, {
            id: "gateway-client",
            version: application.version,
            mode: "backend",
          });
          socket.send(
            JSON.stringify({
              type: "res",
              id: request.id,
              ok: true,
              payload: {
                type: "hello-ok",
                protocol: 4,
                auth: { scopes: ["operator.admin"] },
                policy: { tickIntervalMs: 30000 },
              },
            }),
          );
          return;
        }
        if (request.method === "exec.approvals.get") {
          administratorProbes++;
          socket.send(
            JSON.stringify({
              type: "res",
              id: request.id,
              ok: true,
              payload: {},
            }),
          );
          return;
        }
        methods.push(request.method);
        const reply = replies.shift();
        assert.ok(reply, "unexpected extra request");
        if (reply === "disconnect") socket.close(1011, "fixture closed");
        else
          socket.send(
            JSON.stringify({
              type: "res",
              id: request.id,
              ok: typeof reply === "string",
              ...(typeof reply === "string"
                ? {
                    payload:
                      reply === "success"
                        ? { ok: true, noop: true }
                        : {
                            ok: true,
                            sentinel: {
                              payload: {
                                stats: { requiresRestart: reply === "restart" },
                              },
                            },
                          },
                  }
                : {
                    error: {
                      code: reply.code,
                      message: "private native details",
                    },
                  }),
            }),
          );
        acknowledged.resolve();
      });
    });
    return {
      options: {
        origin: `https://127.0.0.1:${address.port}`,
        credential: "fixture-session",
      },
      methods,
      acknowledged: acknowledged.promise,
      reconnected: reconnected.promise,
      disconnect: (code: number) => {
        for (const client of server.clients)
          client.close(code, "fixture close");
      },
      administratorProbes: () => administratorProbes,
      close: () =>
        new Promise<void>((resolve, reject) => {
          for (const client of server.clients) client.terminate();
          server.close(() =>
            listener.close((error) => (error ? reject(error) : resolve())),
          );
        }),
    };
  }

  await test("config acknowledgement cannot finish setup before its scheduled restart and authenticated reconnection", async () => {
    const fixture = await gatewayFixture(["restart", "success"]);
    let completed = false;
    try {
      const operation = withGateway(fixture.options, async (gateway) => {
        await gateway.mutate("config.patch", {});
        await gateway.read("config.get", {});
        completed = true;
      });
      await fixture.acknowledged;
      await setImmediate();
      assert.equal(completed, false);
      assert.deepEqual(fixture.methods, ["config.patch"]);
      fixture.disconnect(1001);
      await fixture.reconnected;
      await setImmediate();
      assert.equal(completed, false, "An unrelated reconnect is not a restart");
      fixture.disconnect(1012);
      await operation;
      assert.equal(completed, true);
      assert.equal(fixture.administratorProbes(), 2);
      assert.deepEqual(fixture.methods, ["config.patch", "config.get"]);
    } finally {
      await fixture.close();
    }
  });

  await test("membership hot application finishes without waiting for a restart", async () => {
    const fixture = await gatewayFixture(["hot"]);
    try {
      await withGateway(fixture.options, (gateway) =>
        gateway.mutate("config.patch", {}),
      );
      assert.equal(fixture.administratorProbes(), 1);
      assert.deepEqual(fixture.methods, ["config.patch"]);
    } finally {
      await fixture.close();
    }
  });

  await test("real correlated native validation/authority rejections stay definitive; transport and activation failures remain uncertain", async () => {
    for (const scenario of [
      { reply: { code: "INVALID_REQUEST" }, code: "request_rejected" },
      { reply: { code: "FORBIDDEN" }, code: "access_denied" },
      // Native config can persist and then report UNAVAILABLE if activation fails.
      { reply: { code: "UNAVAILABLE" }, code: "outcome_unknown" },
      { reply: { code: "UNKNOWN_FUTURE_CODE" }, code: "outcome_unknown" },
      { reply: "disconnect", code: "outcome_unknown" },
    ] satisfies { reply: Reply; code: string }[]) {
      const fixture = await gatewayFixture([scenario.reply]);
      try {
        await assert.rejects(
          withGateway(fixture.options, (gateway) =>
            gateway.mutate("config.patch", {}),
          ),
          (error: unknown) =>
            error instanceof NativeFailure && error.code === scenario.code,
        );
        assert.equal(fixture.administratorProbes(), 1);
        assert.deepEqual(
          fixture.methods,
          ["config.patch"],
          "mutations must never be replayed",
        );
      } finally {
        await fixture.close();
      }
    }
  });

  await test("a failed later mutation or observation never claims earlier successful writes were rolled back", async () => {
    for (const observe of [false, true]) {
      const fixture = await gatewayFixture([
        "success",
        { code: "INVALID_REQUEST" },
      ]);
      try {
        await assert.rejects(
          withGateway(fixture.options, async (gateway) => {
            await gateway.mutate("config.patch", {});
            if (observe) await gateway.read("config.get", {});
            else await gateway.mutate("users.update", {});
          }),
          (error: unknown) =>
            error instanceof NativeFailure && error.code === "outcome_unknown",
        );
        assert.equal(fixture.methods.length, 2);
      } finally {
        await fixture.close();
      }
    }
  });
  await test("SDK handshake HTTP authorization denial is definitive before dispatch, unlike server unavailability", async () => {
    for (const status of [401, 403, 503]) {
      const listener = createServer({ cert: certificate, key: privateKey });
      listener.on("upgrade", (_request, socket) => {
        socket.end(
          `HTTP/1.1 ${status} Rejected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
        );
      });
      listener.listen(0, "127.0.0.1");
      await once(listener, "listening");
      const address = listener.address();
      assert.ok(address && typeof address !== "string");
      let dispatched = false;
      try {
        await assert.rejects(
          withGateway(
            {
              origin: `https://127.0.0.1:${address.port}`,
              credential: "revoked",
            },
            () => {
              dispatched = true;
              return Promise.resolve();
            },
          ),
          { code: status === 503 ? "unavailable" : "access_denied" },
        );
        assert.equal(dispatched, false);
      } finally {
        await new Promise<void>((resolve, reject) =>
          listener.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });
});
