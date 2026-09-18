import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify from "fastify";
import { z } from "zod";
import {
  registerCloudServices,
  readHostedRegistration,
  hostedOidc,
  hostedConnections,
} from "./cloud/registration.js";
import { installationSchema } from "./installation/configuration.js";

function configuration(cloudUrl: string) {
  return installationSchema.parse({
    schemaVersion: 1,
    name: "test-team",
    releaseFile: "release.json",
    stateDirectory: "state",
    exposure: { mode: "local", applicationPort: 18800, widgetPort: 18801 },
    access: { mode: "hosted", cloudUrl, administratorName: "Administrator" },
    resources: {
      runtime: { cpu: "1", memory: "4Gi" },
    },
    browser: { enabled: false },
    models: {
      mode: "litellm",
      configurationFile: "models.json",
      upstreamEnvironmentFile: "models.env",
    },
    connections: { mode: "disabled" },
    packs: [],
  });
}

await test("hosted registration survives a lost response without changing account, reference or keys", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-registration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = Fastify();
  t.after(() => app.close());
  const accountId = randomUUID(),
    otherAccountId = randomUUID(),
    id = randomUUID();
  let dispatched: unknown;
  let posts = 0,
    identities = 0;
  let rejected = true;
  app.get("/api/account", (request) => ({
    accountId:
      request.headers.authorization === "Bearer other"
        ? otherAccountId
        : accountId,
  }));
  app.post("/api/installations", (request, reply) => {
    posts++;
    if (posts === 1) {
      dispatched = request.body;
      reply.raw.destroy();
      return reply;
    }
    assert.deepEqual(request.body, dispatched);
    return { id, origin: "http://127.0.0.1:18800", oidcState: "ready" };
  });
  app.get("/api/installations/:id/identity", async (request, reply) => {
    identities++;
    const saved = await readHostedRegistration(
      join(directory, "secrets/hosted-login.json"),
    );
    assert.equal(
      request.headers.authorization,
      `Bearer ${saved.request.managementSecret}`,
    );
    if (rejected) return reply.code(401).send({ code: "credential_revoked" });
    return {
      issuer: "https://identity.example",
      clientId: "client-example",
      clientSecret: "private-secret",
    };
  });
  const cloudUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  const file = join(directory, "installation.json");
  const config = configuration(cloudUrl);
  await writeFile(file, JSON.stringify(config));
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const pending = registerCloudServices(file, async () => {
    entered.resolve(undefined);
    await resume.promise;
    return "owner";
  });
  await entered.promise;
  await assert.rejects(
    registerCloudServices(file, () => Promise.resolve("owner")),
    { code: "ELOCKED" },
  );
  resume.resolve(undefined);
  await assert.rejects(pending);
  const saved = await readHostedRegistration(
    join(directory, "secrets/hosted-login.json"),
  );
  assert.equal(saved.accountId, accountId);
  assert.equal(saved.installationId, undefined);
  await assert.rejects(
    registerCloudServices(file, () => Promise.resolve("other")),
    { code: "change_unsupported" },
  );
  assert.equal(posts, 1);
  await assert.rejects(
    registerCloudServices(file, () => Promise.resolve("owner")),
    { code: "unavailable" },
  );
  assert.equal(posts, 2);
  assert.equal(
    (await readHostedRegistration(join(directory, "secrets/hosted-login.json")))
      .installationId,
    id,
  );
  // Revoked credentials never cause a new registration or fresh keys.
  await assert.rejects(
    registerCloudServices(file, () => {
      throw Error("must not authorize again");
    }),
    { code: "unavailable" },
  );
  assert.equal(posts, 2);
  rejected = false;
  await registerCloudServices(file, () => {
    throw Error("must not authorize again");
  });
  assert.equal(identities, 3);
  const oidc = await hostedOidc(join(directory, "secrets/hosted-login.json"));
  assert.equal(oidc.clientId, "client-example");
  assert.equal((await stat(oidc.clientSecretFile)).mode & 0o777, 0o600);
  config.connections.mode = "hosted";
  config.connections.cloudUrl = cloudUrl;
  await writeFile(file, JSON.stringify(config));
  await registerCloudServices(file, () => {
    throw Error("Connections must reuse hosted login registration");
  });
  const connections = await hostedConnections(config, file);
  assert.ok(connections);
  assert.equal(connections.brokerUrl, `${cloudUrl}/api/connections`);
  assert.equal((await stat(connections.managementKeyFile)).mode & 0o777, 0o600);
  assert.equal(posts, 2);
  config.connections.mode = "disabled";
  assert.equal(await hostedConnections(config, file), undefined);
  await app.close();
  // Retained installation setup is independent of cloud availability.
  await registerCloudServices(file, () => {
    throw Error("must not authorize again");
  });
  await writeFile(
    file,
    JSON.stringify({
      ...config,
      access: {
        mode: "oidc",
        administratorName: "Administrator",
        issuer: "https://company.example",
        clientId: "own-client",
        clientSecretFile: "company-secret",
      },
    }),
  );
  await registerCloudServices(file, () => {
    throw Error("custom OIDC must not contact cloud");
  });
});

await test("company OIDC registers only enabled Connections and preserves its credential across disable/re-enable", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "clawscarf-connections-registration-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = Fastify();
  t.after(() => app.close());
  let posts = 0;
  app.get("/api/account", () => ({ accountId: randomUUID() }));
  app.post("/api/installations", (request) => {
    posts++;
    assert.equal(
      z.object({ origin: z.null() }).parse(request.body).origin,
      null,
    );
    return { id: randomUUID(), origin: null, oidcState: "disabled" };
  });
  const cloudUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  const config = configuration(cloudUrl);
  config.access = {
    mode: "oidc",
    administratorName: "Administrator",
    issuer: "https://company.example",
    clientId: "own-client",
    clientSecretFile: "company-secret",
  };
  config.connections.cloudUrl = cloudUrl;
  const file = join(directory, "installation.json");
  await writeFile(file, JSON.stringify(config));
  const mustNotAuthorize = () => {
    throw Error("must not contact cloud");
  };
  await registerCloudServices(file, mustNotAuthorize);
  assert.equal(posts, 0);
  config.connections.mode = "hosted";
  await writeFile(file, JSON.stringify(config));
  await registerCloudServices(file, () => Promise.resolve("owner"));
  const before = await readHostedRegistration(
    join(directory, config.connections.registrationFile),
  );
  assert.equal(before.identity, undefined);
  assert.ok(await hostedConnections(config, file));
  await app.close();
  config.connections.mode = "disabled";
  await writeFile(file, JSON.stringify(config));
  await registerCloudServices(file, mustNotAuthorize);
  assert.equal(await hostedConnections(config, file), undefined);
  config.connections.mode = "hosted";
  await writeFile(file, JSON.stringify(config));
  await registerCloudServices(file, mustNotAuthorize);
  const after = await readHostedRegistration(
    join(directory, config.connections.registrationFile),
  );
  assert.deepEqual(after, before);
  assert.equal(posts, 1);
});
