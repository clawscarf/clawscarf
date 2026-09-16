import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { ensureCertificates } from "../../scripts/local/certificates.js";
const execute = promisify(execFile);

await test("credential CLI issues and revokes over private TLS only with the trusted CA", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-model-tls-"));
  await ensureCertificates(directory);
  const requests: {
    path: string | undefined;
    authorization: string | undefined;
    body: unknown;
  }[] = [];
  const server = createServer(
    {
      key: await readFile(join(directory, "management-key.pem")),
      cert: await readFile(join(directory, "management-cert.pem")),
    },
    (request, response) => {
      void (async () => {
        let body = "";
        for await (const chunk of request) body += String(chunk);
        requests.push({
          path: request.url,
          authorization: request.headers.authorization,
          body: JSON.parse(body) as unknown,
        });
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify(
            request.url === "/key/generate"
              ? { key: "sk-scoped-runtime" }
              : { deleted: true },
          ),
        );
      })().catch(() => response.destroy());
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `https://127.0.0.1:${String(address.port)}`;
    const master = join(directory, "master");
    const output = join(directory, "runtime");
    await writeFile(master, "sk-master-secret", { mode: 0o600 });
    const common = ["--origin", origin, "--master-key-file", master];
    const issue = [
      "--import",
      "tsx",
      "scripts/clawscarf.ts",
      "models",
      "issue-key",
      "--config",
      "deploy/models/config.example.json",
      "--output",
      output,
      ...common,
    ];
    await assert.rejects(execute(process.execPath, issue));
    assert.equal(requests.length, 0);
    const trust = ["--ca-file", join(directory, "management-ca.pem")];
    const result = await execute(process.execPath, [...issue, ...trust]);
    assert.ok(!result.stdout.includes("sk-"));
    assert.equal((await readFile(output, "utf8")).trim(), "sk-scoped-runtime");
    const revoke = [
      "--import",
      "tsx",
      "scripts/clawscarf.ts",
      "models",
      "revoke-key",
      ...common,
      "--key-file",
      output,
      "--yes",
    ];
    await assert.rejects(execute(process.execPath, revoke));
    assert.equal(requests.length, 1);
    await execute(process.execPath, [...revoke, ...trust]);
    assert.deepEqual(requests, [
      {
        path: "/key/generate",
        authorization: "Bearer sk-master-secret",
        body: { models: ["team-model"], key_type: "llm_api" },
      },
      {
        path: "/key/delete",
        authorization: "Bearer sk-master-secret",
        body: { keys: ["sk-scoped-runtime"] },
      },
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
