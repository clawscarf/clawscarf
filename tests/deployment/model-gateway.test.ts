import { oidcTeam } from "./oidc.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGatewayConfiguration } from "../../scripts/deployment/model-gateway.js";
import { modelGatewayServices } from "../../scripts/deployment/model-gateway-compose.js";
import { parseLocalInput } from "../../scripts/deployment/configuration.js";

const configuration = {
  defaultModel: "team",
  models: [
    {
      id: "team",
      name: "Team",
      enabled: true,
      contextWindow: 8192,
      maxTokens: 1024,
      reasoning: false,
      tools: true,
      input: ["text"],
      route: { model: "openai/test", apiKeyEnv: "UPSTREAM_KEY" },
    },
  ],
};
await test("local gateway validates routes and accepts only their upstream credentials", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-model-routes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, "models.json"),
    env = join(root, "keys.env");
  await writeFile(config, JSON.stringify(configuration));
  await writeFile(env, "UPSTREAM_KEY=private-test-key\n");
  assert.equal(
    (await loadGatewayConfiguration(config, env)).environment.UPSTREAM_KEY,
    "private-test-key",
  );
  for (const bad of [
    "",
    "UPSTREAM_KEY=ok\nLITELLM_MASTER_KEY=bad",
    'UPSTREAM_KEY="line1\nline2"',
  ]) {
    await writeFile(env, bad);
    await assert.rejects(loadGatewayConfiguration(config, env));
  }
});
await test("disabled models add no service; enabled gateway has TLS and no published database port", () => {
  const input = parseLocalInput({
    name: "test",
    agentName: "ClawScarf",
    administratorName: "Test",
    runtimeImage: "sha256:" + "1".repeat(64),
    companionImage: "sha256:" + "2".repeat(64),
    openshellCli: "/bin/test",
    openshellGateway: "/bin/test",
    openshellClientImage: `sha256:${"a".repeat(64)}`,
    cpu: "1",
    memory: "1Gi",
    team: oidcTeam(18001, 18002),
    ports: {
      controller: 18000,
      application: 18001,
      widgets: 18002,
      management: 18003,
      native: 18004,
      nativeWidgets: 18005,
      database: 18006,
    },
  });
  const state = {
    schemaVersion: 1 as const,
    ownerId: "00000000-0000-4000-8000-000000000001",
    input,
  };
  assert.deepEqual(modelGatewayServices("/private", state), {});
  const enabled = {
    ...state,
    input: {
      ...input,
      modelGateway: {
        image: "sha256:" + "3".repeat(64),
        port: 18007,
        configurationFile: "/config",
        upstreamEnvironmentFile: "/keys",
      },
    },
  };
  const services = modelGatewayServices("/private", enabled);
  assert.deepEqual(services.models?.ports, ["127.0.0.1:18007:4000"]);
  assert.ok(services.models?.command.includes("--ssl_keyfile_path"));
  assert.equal("ports" in (services["models-database"] ?? {}), false);
});
