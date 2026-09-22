import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:https";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { z } from "zod";
const exec = promisify(execFile);
await test("billing owner uses the real OIDC device protocol and rejects a different Cloud account", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "clawscarf-billing-owner-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cert = join(dir, "cert.pem"),
    key = join(dir, "key.pem");
  await exec("openssl", [
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
    "subjectAltName=IP:127.0.0.1",
    "-keyout",
    key,
    "-out",
    cert,
  ]);
  let url = "",
    exchanges = 0,
    challenges = 0;
  const accountId = randomUUID();
  const server = createServer(
    { cert: await readFile(cert), key: await readFile(key) },
    (req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req)
          chunks.push(
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
          );
        res.setHeader("content-type", "application/json");
        const send = (value: unknown, status = 200) => {
          res.statusCode = status;
          res.end(JSON.stringify(value));
        };
        switch (req.url) {
          case "/api/identity":
            return send({ issuer: url, clientId: "billing-client" });
          case "/.well-known/openid-configuration":
            return send({
              issuer: url,
              device_authorization_endpoint: url + "/device",
              token_endpoint: url + "/token",
              jwks_uri: url + "/jwks",
              response_types_supported: ["code"],
              subject_types_supported: ["public"],
              id_token_signing_alg_values_supported: ["RS256"],
              token_endpoint_auth_methods_supported: ["none"],
            });
          case "/device":
            challenges++;
            assert.equal(
              new URLSearchParams(Buffer.concat(chunks).toString()).get(
                "client_id",
              ),
              "billing-client",
            );
            return send({
              device_code: "device" + challenges,
              user_code: "TEST-CODE",
              verification_uri: url + "/verify",
              expires_in: 600,
              interval: 1,
            });
          case "/token": {
            exchanges++;
            const body = new URLSearchParams(Buffer.concat(chunks).toString());
            assert.equal(
              body.get("grant_type"),
              "urn:ietf:params:oauth:grant-type:device_code",
            );
            if (exchanges === 1)
              return send({ error: "authorization_pending" }, 400);
            return send({
              access_token:
                exchanges === 2 ? "different-owner" : "matching-owner",
              token_type: "Bearer",
              expires_in: 3600,
            });
          }
          case "/api/account":
            assert.equal(req.headers.cookie, undefined);
            return send({
              accountId:
                req.headers.authorization === "Bearer matching-owner"
                  ? accountId
                  : randomUUID(),
            });
          default:
            return send({ error: "not_found" }, 404);
        }
      })().catch((error: unknown) => {
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : "failure",
          }),
        );
      });
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = z.object({ port: z.number() }).parse(server.address());
  url = `https://127.0.0.1:${address.port}`;
  await exec(
    process.execPath,
    [
      "--import",
      "tsx",
      "tests/companion/billing-owner.fixture.ts",
      url,
      accountId,
    ],
    { env: { ...process.env, NODE_EXTRA_CA_CERTS: cert }, timeout: 20000 },
  );
  assert.equal(challenges, 2);
  assert.equal(exchanges, 3);
});
