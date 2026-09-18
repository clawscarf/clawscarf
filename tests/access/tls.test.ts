import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { get } from "node:https";
import { createIngress } from "../../services/access/providers/ingress.js";
await test("application and management TLS require a trusted CA and share authenticated ingress", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-tls-"));
  try {
    const config = join(directory, "tls.cnf"),
      key = join(directory, "key.pem"),
      cert = join(directory, "ca.pem");
    await writeFile(
      config,
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
      config,
      "-keyout",
      key,
      "-out",
      cert,
    ]);
    const ca = await readFile(cert);
    const ingress = createIngress(
      { authenticate: () => Promise.resolve({ identity: "clawscarf:test" }) },
      [
        {
          origin: "http://127.0.0.1:18800",
          upstream: "http://127.0.0.1:1",
          kind: "application",
        },
      ],
      (_req, res) => {
        res.end("same access handler");
      },
      {
        management: { cert: ca, key: await readFile(key) },
        application: { cert: ca, key: await readFile(key) },
      },
    );
    try {
      for (const listener of [ingress.managementServer, ingress.server]) {
        assert.ok(listener);
        listener.listen(0, "127.0.0.1");
        await once(listener, "listening");
        const address = listener.address();
        assert.ok(address && typeof address !== "string");
        const read = (trusted: boolean) =>
          new Promise<string>((resolve, reject) => {
            get(
              {
                hostname: "127.0.0.1",
                port: address.port,
                path: "/_clawscarf/health",
                headers: { host: "127.0.0.1:18800" },
                ...(trusted ? { ca } : {}),
              },
              (res) => {
                let body = "";
                res.setEncoding("utf8");
                res.on("data", (chunk: string) => {
                  body += chunk;
                });
                res.on("end", () => resolve(body));
              },
            ).on("error", reject);
          });
        await assert.rejects(read(false), {
          code: "DEPTH_ZERO_SELF_SIGNED_CERT",
        });
        assert.equal(await read(true), "same access handler");
      }
    } finally {
      await ingress.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
