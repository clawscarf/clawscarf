import assert from "node:assert/strict";
import { test } from "node:test";
import { configuredBrowser } from "../../deploy/execution/browser-node/operator.js";
import { browserDefaults } from "../../scripts/deployment/browser.js";
import { browserComposeSettings } from "../../scripts/deployment/browser-settings.js";

await test("retained browser toggles preserve native settings, profiles and other node capabilities", () => {
  const saved = {
    agents: { defaults: { thinkingDefault: "high" } },
    browser: {
      headless: true,
      profiles: { custom: { cdpUrl: "http://custom:9223" } },
    },
    plugins: {
      entries: {
        browser: { config: { custom: true } },
        another: { enabled: true },
      },
    },
    gateway: {
      nodes: {
        allowCommands: ["another.command"],
        pairing: { allowCidrs: ["10.2.0.0/24"] },
      },
    },
  };
  const original = structuredClone(saved);
  const settings = {
    enabled: true,
    token: "a".repeat(64),
    node: "owned-browser",
  } as const;
  const on = configuredBrowser(saved, settings);
  assert.deepEqual(saved, original);
  assert.ok("agents" in on);
  assert.deepEqual(on.agents, saved.agents);
  assert.deepEqual(on.browser, {
    ...saved.browser,
    ...browserDefaults(settings.token),
    profiles: {
      ...saved.browser.profiles,
      ...browserDefaults(settings.token).profiles,
    },
  });
  assert.deepEqual(on.gateway.nodes, {
    ...saved.gateway.nodes,
    pairing: { ...saved.gateway.nodes.pairing, autoApproveLocal: false },
    browser: { mode: "manual", node: settings.node },
  });
  assert.deepEqual(on.plugins.entries.browser, {
    config: { custom: true },
    enabled: true,
  });
  const off = configuredBrowser(on, { enabled: false });
  assert.deepEqual(off.browser, { ...on.browser, enabled: false });
  assert.deepEqual(off.gateway.nodes.browser, {
    mode: "off",
    node: settings.node,
  });
  assert.equal(off.plugins.entries.browser.enabled, false);
  assert.deepEqual(configuredBrowser(off, settings), on);
  assert.deepEqual(configuredBrowser(on, settings), on);
});

await test("browser Compose changes preserve unrelated services and remove only browser services", () => {
  const saved = {
    name: "owned",
    services: { companion: { custom: true }, browser: { old: true } },
    networks: { runtime: { name: "retained" }, browser: { old: true } },
    volumes: { database: { retained: true }, browser: { old: true } },
    secrets: { database_password: { file: "private" } },
  };
  const generated = {
    services: {
      companion: { custom: false },
      browser: { new: true },
      "browser-node": { isolated: true },
    },
    networks: { runtime: { name: "different" }, browser: { new: true } },
    volumes: { database: {}, browser: { new: true } },
  };
  const on = browserComposeSettings(saved, generated);
  assert.deepEqual(on.services.companion, saved.services.companion);
  assert.deepEqual(on.networks.runtime, saved.networks.runtime);
  assert.deepEqual(on.volumes.database, saved.volumes.database);
  assert.deepEqual(on.secrets, saved.secrets);
  assert.deepEqual(on.services.browser, generated.services.browser);
  const off = browserComposeSettings(on, {
    services: {},
    networks: {},
    volumes: {},
  });
  assert.deepEqual(off.services, { companion: saved.services.companion });
  assert.deepEqual(off.networks, { runtime: saved.networks.runtime });
  assert.deepEqual(off.volumes, { database: saved.volumes.database });
});
