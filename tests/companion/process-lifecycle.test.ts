import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { runServer } from "../../apps/process-lifecycle.js";

const close = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => (error ? reject(error) : resolve()));
  });

await test("process startup cleans the first listener when the second bind fails", async () => {
  const occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const address = occupied.address();
  assert.ok(address && typeof address !== "string");
  const first = createServer();
  const second = createServer();
  let closed = 0;
  try {
    await assert.rejects(
      runServer(
        [
          { server: first, port: 0, host: "127.0.0.1" },
          { server: second, port: address.port, host: "127.0.0.1" },
        ],
        async () => {
          closed++;
          await Promise.all([close(first), close(second)]);
        },
      ),
      { code: "EADDRINUSE" },
    );
    assert.equal(closed, 1);
    assert.equal(first.listening, false);
  } finally {
    await close(occupied);
    await close(first);
    await close(second);
  }
});

await test("concurrent process stops close once and remove both signal listeners", async () => {
  const server = createServer();
  const interrupts = process.listenerCount("SIGINT");
  const terminations = process.listenerCount("SIGTERM");
  let closed = 0;
  const stop = await runServer(
    [{ server, port: 0, host: "127.0.0.1" }],
    async () => {
      closed++;
      await close(server);
    },
  );
  assert.equal(process.listenerCount("SIGINT"), interrupts + 1);
  assert.equal(process.listenerCount("SIGTERM"), terminations + 1);
  await Promise.all([stop(), stop()]);
  assert.equal(closed, 1);
  assert.equal(server.listening, false);
  assert.equal(process.listenerCount("SIGINT"), interrupts);
  assert.equal(process.listenerCount("SIGTERM"), terminations);
});
