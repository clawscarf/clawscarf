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

await test("shared browser is admitted through the native sandbox tool policy only when execution and browser are both enabled", () => {
  for (const execution of [false, true]) {
    for (const browser of [false, true]) {
      const native = preset();
      const original = structuredClone(native);
      const result = withInitialServices(native, {
        execution,
        ...(browser ? { browserToken: token } : {}),
      });
      const toolPolicy =
        "sandbox" in result.tools ? result.tools.sandbox : undefined;
      assert.deepEqual(
        toolPolicy,
        execution && browser
          ? { tools: { alsoAllow: ["browser"] } }
          : undefined,
      );
      assert.deepEqual(result.tools.alsoAllow, ["lobster"]);
      assert.deepEqual(result.tools.exec, native.tools.exec);
      assert.deepEqual(result.tools.sessions, native.tools.sessions);
      assert.deepEqual(result.tools.elevated, { enabled: false });
      assert.deepEqual(result.gateway, native.gateway);
      assert.deepEqual(result.plugins, native.plugins);
      const defaults = "agents" in result ? result.agents?.defaults : undefined;
      const sandbox =
        defaults && "sandbox" in defaults ? defaults.sandbox : undefined;
      if (execution) {
        assert.ok(sandbox);
        assert.equal(sandbox.backend, "ssh");
        assert.equal(
          sandbox.ssh.target,
          "node@runtime.clawscarf.internal:2222",
        );
        assert.deepEqual(
          sandbox.browser,
          browser ? { enabled: false, allowHostControl: true } : undefined,
        );
      } else assert.equal(sandbox, undefined);
      if (browser) {
        assert.equal(result.browser.headless, native.browser.headless);
        assert.equal(result.browser.noSandbox, false);
        assert.partialDeepStrictEqual(result.browser, {
          profiles: { team: { attachOnly: true } },
          ssrfPolicy: { allowedHostnames: ["runtime.clawscarf.internal"] },
        });
      } else assert.deepEqual(result.browser, native.browser);
      assert.deepEqual(
        native,
        original,
        "Fresh preset composition must not mutate its input",
      );
      if (!execution && !browser) assert.deepEqual(result, native);
    }
  }
});

await test("execution and browser defaults retain configured model selection, provider secret references and preset tools", () => {
  const configured = withInitialModels(preset(), models);
  const original = structuredClone(configured);
  const result = withInitialServices(configured, {
    execution: true,
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
      execution: true,
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
    execution: true,
    browserToken: token,
    connectionsBrokerUrl: "https://broker.example.test",
  });
  assert.ok("secrets" in result);
  assert.ok("clawscarf-models" in result.secrets.providers);
  assert.ok("clawscarf-connections" in result.secrets.providers);
  assert.ok(result.plugins.entries["clawscarf-connections"].enabled);
  assert.match(JSON.stringify(result.tools), /connections_search/);
  assert.match(JSON.stringify(result.tools), /browser/);
  assert.ok(!JSON.stringify(result).includes(models.credential.token));
});
