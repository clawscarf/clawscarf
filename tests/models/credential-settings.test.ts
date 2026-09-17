import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { z } from "zod";
import { setRuntimeCredentialModels } from "../../scripts/models/credentials.js";

await test("model permission updates observe the retained key, preserve blocking/expiry, and never recreate or blindly retry", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-key-settings-"));
  const masterKeyFile = join(directory, "master"),
    keyFile = join(directory, "runtime");
  await writeFile(masterKeyFile, "sk-master", { mode: 0o600 });
  await writeFile(keyFile, "sk-existing", { mode: 0o600 });
  let models = ["old"];
  const writes: unknown[] = [];
  let missing = false,
    loseResponse = false;
  const server = createServer((req, res) => {
    void (async () => {
      assert.equal(req.headers.authorization, "Bearer sk-master");
      assert.ok(!req.url?.includes("sk-existing"));
      if (req.method === "GET" && req.url?.startsWith("/key/info?key=")) {
        res.writeHead(missing ? 404 : 200, {
          "content-type": "application/json",
        });
        res.end(
          JSON.stringify({
            info: {
              models,
              blocked: true,
              expires: "2020-01-01T00:00:00+00:00",
            },
          }),
        );
        return;
      }
      assert.equal(req.url, "/key/update");
      let body = "";
      for await (const part of req) body += String(part);
      const value = z
        .strictObject({
          key: z.literal("sk-existing"),
          models: z.array(z.string()),
        })
        .parse(JSON.parse(body));
      writes.push(value);
      models = value.models;
      if (loseResponse) {
        req.socket.destroy();
        return;
      }
      res.end("{}");
    })().catch((error: unknown) => {
      t.assert.fail(String(error));
      res.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const input = {
    origin: `http://127.0.0.1:${String(address.port)}`,
    masterKeyFile,
    keyFile,
    models: ["new"],
  };
  await setRuntimeCredentialModels(input);
  assert.equal(writes.length, 1);
  await setRuntimeCredentialModels(input);
  assert.equal(writes.length, 1);
  loseResponse = true;
  await assert.rejects(
    setRuntimeCredentialModels({ ...input, models: ["another"] }),
  );
  assert.equal(writes.length, 2);
  // An explicit subsequent apply observes that the first request succeeded and sends no mutation.
  await setRuntimeCredentialModels({ ...input, models: ["another"] });
  assert.equal(writes.length, 2);
  missing = true;
  await assert.rejects(
    setRuntimeCredentialModels(input),
    /will not be replaced/,
  );
  assert.equal(writes.length, 2);
});
