import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:https";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { runtimeTrust } from "../../runtime/trust.js";

const execute = promisify(execFile);

await test("runtime trusts controller, model and Connections CAs together, but rejects an unrelated CA", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-trust-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "clawscarf-models"), { mode: 0o700 });
  const origins: string[] = [];
  for (const name of ["controller", "model", "connections", "unrelated"]) {
    const key = join(directory, `${name}.key`);
    const cert = join(directory, `${name}.pem`);
    await execute("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      `/CN=${name}`,
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      key,
      "-out",
      cert,
    ]);
    const server = createServer(
      { key: await readFile(key), cert: await readFile(cert) },
      (_req, res) => res.end("ok"),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    t.after(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    origins.push(`https://127.0.0.1:${String(address.port)}`);
  }
  const model = join(directory, "clawscarf-models", "ca.pem");
  await writeFile(model, await readFile(join(directory, "model.pem")), {
    mode: 0o600,
  });
  assert.equal(await runtimeTrust(directory, undefined), model);
  const connections = join(directory, "clawscarf-connections");
  await mkdir(connections, { mode: 0o700 });
  await writeFile(
    join(connections, "runtime.json"),
    JSON.stringify({ token: "fixture" }),
    { mode: 0o600 },
  );
  await writeFile(
    join(connections, "ca.pem"),
    await readFile(join(directory, "connections.pem")),
    { mode: 0o600 },
  );
  const paths = await Promise.all(
    Array.from({ length: 4 }, () =>
      runtimeTrust(directory, join(directory, "controller.pem")),
    ),
  );
  assert.equal(new Set(paths).size, 1);
  assert.equal(
    (await readdir(join(directory, "clawscarf-models", "trust"))).length,
    1,
  );
  const bundle = paths[0];
  assert.ok(bundle);
  const { stdout } = await execute(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    const result = [];
    for (const url of process.argv.slice(1)) {
      try { result.push((await fetch(url)).status); }
      catch (error) { result.push(error.cause?.code); }
    }
    console.log(JSON.stringify(result));
  `,
      ...origins,
    ],
    { env: { ...process.env, NODE_EXTRA_CA_CERTS: bundle }, timeout: 10000 },
  );
  assert.deepEqual(JSON.parse(stdout), [
    200,
    200,
    200,
    "DEPTH_ZERO_SELF_SIGNED_CERT",
  ]);
  await assert.rejects(runtimeTrust(directory, join(directory, "missing.pem")));
  await writeFile(bundle, "tampered");
  await assert.rejects(
    runtimeTrust(directory, join(directory, "controller.pem")),
    /content digest/,
  );
});
