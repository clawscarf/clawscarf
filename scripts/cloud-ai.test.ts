import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify from "fastify";
import { configureCloudAi } from "./cloud/ai.js";
import { cloudModelCatalog, validateCloudRoutes } from "./cloud/models.js";
import type { InstallationConfiguration } from "./installation/configuration.js";

await test("Cloud AI retains scoped credentials across lost issuance responses, checks ownership and respects revocation", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "clawscarf-ai-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "secrets"), { mode: 0o700 });
  const id = randomUUID(),
    accountId = randomUUID();
  let other = false,
    enabled = false,
    active = false,
    generation = 0,
    revision = 0,
    issues = 0;
  let issued: unknown;
  const notes: string[] = [];
  const model = {
    id: "openai/test",
    name: "Test",
    protocols: ["responses" as const],
    contextTokens: 8192,
    maxOutputTokens: 1024,
    inputMicrosPerMillion: 1,
    outputMicrosPerMillion: 1,
    rateVersion: "test",
  };
  let url = "";
  const server = Fastify();
  t.after(() => server.close());
  server.get("/api/account", () => ({
    accountId: other ? randomUUID() : accountId,
  }));
  server.get("/api/ai/models", () => ({ models: [model], defaultModel: null }));
  const state = () => ({
    enabled,
    revision,
    modelIds: enabled ? [model.id] : [],
    generation,
    credentialActive: active,
    inferenceUrl: url + "/v1",
  });
  server.get("/api/installations/:id/ai", state);
  server.put("/api/installations/:id/ai", () => {
    enabled = true;
    revision++;
    return state();
  });
  server.put("/api/installations/:id/ai/credential", (r, p) => {
    issues++;
    if (!issued) {
      issued = r.body;
      generation++;
      active = true;
      p.raw.destroy();
      return p;
    }
    assert.deepEqual(r.body, issued);
    return { generation };
  });
  server.get("/api/installations/:id/allowances", () => ({
    ai: { available: 0, state: "exhausted" },
  }));
  url = await server.listen({ host: "127.0.0.1", port: 0 });
  const routes = {
    models: cloudModelCatalog([model], url).map((x) => x.model),
    defaultModel: model.id,
  };
  await writeFile(join(dir, "models.json"), JSON.stringify(routes));
  const models: InstallationConfiguration["models"] = {
    mode: "litellm",
    cloud: { url, registrationFile: "secrets/registration.json" },
    configurationFile: "models.json",
    upstreamEnvironmentFile: "secrets/cloud-ai.env",
  };
  const run = () =>
    configureCloudAi(
      join(dir, "installation.json"),
      models,
      { accountId, installationId: id, cloudUrl: url },
      join(dir, "secrets/registration.json"),
      () => Promise.resolve("owner"),
      (message) => notes.push(message),
    );
  await assert.rejects(run());
  await run();
  assert.equal(issues, 2);
  assert.match(notes.join(), /exhausted/);
  assert.match(notes.join(), /Account/);
  const secret = await readFile(join(dir, "secrets/cloud-ai.env"), "utf8");
  assert.match(secret, /^CLAWSCARF_CLOUD_AI_KEY='[A-Za-z0-9_-]{43}'\n$/);
  assert.equal(
    (await stat(join(dir, "secrets/cloud-ai.env"))).mode & 0o777,
    0o600,
  );
  await run();
  assert.equal(issues, 2);
  assert.equal(
    await readFile(join(dir, "secrets/cloud-ai.env"), "utf8"),
    secret,
  );
  other = true;
  await assert.rejects(run(), /account that owns/);
  other = false;
  active = false;
  await assert.rejects(run(), /revoked or replaced/);
  assert.equal(issues, 2);
  const first = routes.models[0];
  assert.ok(first?.route);
  first.route.apiBase = "https://openrouter.ai/api/v1";
  assert.throws(
    () => validateCloudRoutes(routes, url),
    /scoped ClawScarf Cloud endpoint/,
  );
});
