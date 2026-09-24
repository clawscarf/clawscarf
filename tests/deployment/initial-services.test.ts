import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialConfiguration } from "../../runtime/configuration.js";
import { initializeHome } from "../../runtime/initialize.js";
import {
  withInitialModels,
  type InitialModels,
} from "../../scripts/deployment/models.js";
import { withInitialServices } from "../../scripts/deployment/initial-services.js";

function preset() {
  return initialConfiguration({
    publicOrigin: "http://127.0.0.1:18800",
    widgetOrigin: "http://127.0.0.1:18802",
    agentName: "ClawScarf",
    administratorIdentity: "clawscarf:test",
  });
}
const token = "f".repeat(64);
const models: InitialModels = {
  configuration: {
    mode: "external",
    baseUrl: "https://models.example.test/v1",
    defaultModel: "team",
    models: [
      {
        id: "team",
        name: "Team",
        enabled: true,
        contextWindow: 16000,
        maxTokens: 2000,
        reasoning: false,
        tools: true,
        input: ["text"],
      },
    ],
  },
  credential: { token: "test-key-never-in-native-configuration" },
  network: {
    host: "models.example.test",
    port: 443,
    protocol: "tcp",
    binary: "/usr/local/bin/node",
  },
};

await test("browser and Connections preserve one local execution model", () => {
  for (const browser of [false, true]) {
    const native = preset();
    const original = structuredClone(native);
    const result = withInitialServices(native, {
      ...(browser ? { browserToken: token } : {}),
    });
    assert.deepEqual(result.agents.defaults, {
      workspace: "/home/node/.openclaw/workspace",
      sandbox: { mode: "off" },
    });
    assert.equal(result.gateway.roles.definitions.member.sandbox, "inherit");
    assert.deepEqual(result.tools, native.tools);
    assert.deepEqual(result.tools.exec, { host: "gateway", mode: "auto" });
    assert.deepEqual(result.tools.alsoAllow, ["lobster"]);
    assert.deepEqual(result.plugins, {
      ...native.plugins,
      entries: {
        ...native.plugins.entries,
        browser: { enabled: browser },
      },
    });
    assert.equal(result.browser.enabled, browser);
    if (browser)
      assert.partialDeepStrictEqual(result.browser, {
        profiles: { team: { attachOnly: true } },
        ssrfPolicy: { allowedHostnames: ["runtime.clawscarf.internal"] },
      });
    else assert.deepEqual(result, native);
    assert.deepEqual(native, original);
  }
});

await test("execution and browser defaults retain configured model selection, provider secret references and preset tools", () => {
  const configured = withInitialModels(preset(), models);
  const original = structuredClone(configured);
  const result = withInitialServices(configured, {
    browserToken: token,
  });
  assert.ok(
    "agents" in result && result.agents && "model" in result.agents.defaults,
  );
  assert.deepEqual(result.agents.defaults.model, { primary: "clawscarf/team" });
  assert.deepEqual(result.models, configured.models);
  assert.ok("secrets" in result && "secrets" in configured);
  assert.deepEqual(result.secrets, configured.secrets);
  assert.deepEqual(result.tools.alsoAllow, ["lobster"]);
  assert.ok(!JSON.stringify(result).includes(models.credential.token));
  assert.deepEqual(configured, original);
});

await test("resuming initialization preserves deliberate native browser, tool and model edits instead of applying the fresh preset again", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "clawscarf-native-services-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const configuration = JSON.stringify(
    withInitialServices(withInitialModels(preset(), models), {
      browserToken: token,
    }),
  );
  const input = {
    ownerId: "00000000-0000-4000-8000-000000000001",
    serverId: "00000000-0000-4000-8000-000000000002",
    configuration,
  };
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  await initializeHome(home, input, uid, gid);
  const path = join(home, ".openclaw/openclaw.json");
  assert.equal(await readFile(path, "utf8"), configuration);
  const edited = JSON.stringify({
    browser: { enabled: false },
    tools: {
      alsoAllow: ["lobster"],
      sandbox: { tools: { deny: ["browser"] } },
    },
    agents: { defaults: { model: { primary: "custom/selected" } } },
  });
  await writeFile(path, edited);
  await initializeHome(home, input, uid, gid);
  assert.equal(await readFile(path, "utf8"), edited);
});

await test("Connections composes with model secrets and protected browser execution without embedding a provider key", () => {
  const result = withInitialServices(withInitialModels(preset(), models), {
    browserToken: token,
    connectionsBrokerUrl: "https://broker.example.test",
  });
  assert.ok("secrets" in result);
  assert.ok("clawscarf-models" in result.secrets.providers);
  assert.ok("clawscarf-connections" in result.secrets.providers);
  assert.ok(result.plugins.entries["clawscarf-connections"].enabled);
  assert.equal(result.plugins.entries.browser.enabled, true);
  assert.equal(result.browser.enabled, true);
  assert.equal("sandbox" in result.tools, false);
  assert.ok(!JSON.stringify(result).includes(models.credential.token));
});

await test("Connections without Browser leaves both native browser switches disabled", () => {
  const result = withInitialServices(withInitialModels(preset(), models), {
    connectionsBrokerUrl: "https://broker.example.test",
  });
  assert.equal(result.browser.enabled, false);
  assert.equal(result.plugins.entries.browser.enabled, false);
  assert.equal(result.plugins.entries["clawscarf-connections"].enabled, true);
  assert.equal(result.mcp.apps.enabled, true);
});
