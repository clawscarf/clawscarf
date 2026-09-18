import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureCertificates } from "../../scripts/deployment/certificates.js";
import { issueRuntimeCredential } from "../../scripts/models/credentials.js";
import { configurationSchema } from "../../scripts/models/configuration.js";

await test("credential operator issues over private TLS only with the trusted CA", async () => {
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
    const input = {
      origin,
      masterKeyFile: master,
      output,
      configuration: configurationSchema.parse(
        JSON.parse(await readFile("deploy/models/config.example.json", "utf8")),
      ),
    };
    await assert.rejects(issueRuntimeCredential(input));
    assert.equal(requests.length, 0);
    await issueRuntimeCredential({
      ...input,
      caFile: join(directory, "management-ca.pem"),
    });
    assert.equal((await readFile(output, "utf8")).trim(), "sk-scoped-runtime");
    assert.deepEqual(requests, [
      {
        path: "/key/generate",
        authorization: "Bearer sk-master-secret",
        body: { models: ["team-model"], key_type: "llm_api" },
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
