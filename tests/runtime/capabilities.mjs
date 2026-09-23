import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import lobster from "/app/clawscarf/native-plugins/node_modules/@openclaw/lobster/dist/index.js";
import { createOpenAIResponsesTransportStreamFn } from "/app/node_modules/@openclaw/ai/dist/transports.mjs";

// Inspect the real request builder, aborting before any network or credentials are used.
const parameters = {
  type: "object",
  properties: { query: { type: "string" }, accountId: { type: "string" } },
  required: ["query"],
  additionalProperties: false,
};
let requestTools;
const stream = createOpenAIResponsesTransportStreamFn()(
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    provider: "clawscarf",
    api: "openai-responses",
    baseUrl: "https://gateway.invalid/v1",
    reasoning: true,
    input: ["text"],
    contextWindow: 1000000,
    maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsStrictMode: true },
  },
  {
    messages: [{ role: "user", content: "Synthetic discovery", timestamp: 0 }],
    tools: [{ name: "search", description: "Synthetic search", parameters }],
  },
  {
    apiKey: "synthetic-not-a-key",
    onPayload(payload) {
      requestTools = payload.tools;
      throw new Error("Diagnostic stop before HTTP");
    },
  },
);
for await (const event of stream) {
  if (event.type === "error" && !requestTools)
    throw new Error(event.error.errorMessage);
}
assert.equal(requestTools?.[0]?.strict, false);
assert.deepEqual(requestTools[0].parameters, parameters);

// Reviewers omit reasoning. Required-reasoning models must retain the provider
// default, including names the pinned runtime has never seen before.
for (const id of [
  "gpt-6-astra",
  "gpt-6-astra-pro",
  "future-required-reasoning-model",
]) {
  let request;
  const events = createOpenAIResponsesTransportStreamFn()(
    {
      id,
      name: id,
      provider: "clawscarf",
      api: "openai-responses",
      baseUrl: "https://gateway.invalid/v1",
      reasoning: true,
      input: ["text"],
      contextWindow: 100000,
      maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: {
        supportsTemperature: false,
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      },
    },
    {
      messages: [
        { role: "user", content: "Synthetic permission review", timestamp: 0 },
      ],
    },
    {
      apiKey: "synthetic-not-a-key",
      temperature: 0,
      maxTokens: 1024,
      onPayload(payload) {
        request = payload;
        throw new Error("Diagnostic stop before HTTP");
      },
    },
  );
  for await (const event of events) {
    if (event.type === "error" && !request)
      throw new Error(event.error.errorMessage);
  }
  assert.ok(request, id);
  assert.equal(request.model, id);
  assert.equal(request.reasoning, undefined, id);
  assert.equal(request.temperature, undefined, id);
}
let factory;
lobster.register({
  registerTool(value) {
    factory = value;
  },
  config: {},
});
assert.equal(factory({ sandboxed: true }), null);
const result = await factory({ sandboxed: false }).execute("probe", {
  action: "run",
  pipeline: "exec --json --shell 'printf \"[1,2,3]\"'",
});
assert.deepEqual(result.details.output, [1, 2, 3]);
const codex = spawnSync(
  "node",
  [
    "/app/dist/extensions/codex/node_modules/@openai/codex/bin/codex.js",
    "--version",
  ],
  { encoding: "utf8" },
);
assert.equal(codex.status, 0);
assert.equal(codex.stdout.trim(), "codex-cli 0.154.0");
const directory = await mkdtemp(join(tmpdir(), "clawscarf-capabilities-"));
const file = join(directory, "openclaw.json");
function nativeCommand(...args) {
  const result = spawnSync("node", ["/app/openclaw.mjs", ...args], {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      HOME: directory,
      OPENCLAW_STATE_DIR: join(directory, "state"),
      OPENCLAW_CONFIG_PATH: file,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
try {
  const workspace = join(directory, "workspace");
  const skillDirectory = join(workspace, "skills", "clawscarf-probe");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    "---\nname: clawscarf-probe\ndescription: Local capability control test.\n---\nReturn the word ready.\n",
  );
  await writeFile(
    file,
    JSON.stringify({
      gateway: { mode: "local" },
      agents: { defaults: { workspace } },
      plugins: {
        allow: ["codex", "lobster"],
        load: {
          paths: [
            "/app/clawscarf/native-plugins/node_modules/@openclaw/lobster",
          ],
        },
        entries: {
          codex: {
            enabled: true,
            config: { sessionCatalog: { enabled: false } },
          },
          lobster: { enabled: true },
        },
      },
    }),
    { flag: "wx", mode: 0o600 },
  );
  const discovery = JSON.parse(nativeCommand("plugins", "list", "--json"));
  assert.deepEqual(discovery.diagnostics, []);
  const plugins = discovery.plugins;
  const bundledCodex = plugins.find((plugin) => plugin.id === "codex");
  assert.equal(bundledCodex?.origin, "bundled");
  assert.equal(bundledCodex?.source, "/app/dist/extensions/codex/index.js");
  assert.ok(bundledCodex?.commands.includes("codex"));
  const inspected = JSON.parse(
    nativeCommand("plugins", "inspect", "codex", "--runtime", "--json"),
  );
  assert.equal(inspected.plugin.origin, "bundled");
  assert.deepEqual(inspected.plugin.agentHarnessIds, ["codex"]);
  assert.ok(inspected.commands.includes("codex"));
  assert.deepEqual(inspected.diagnostics, []);
  const doctor = JSON.parse(nativeCommand("plugins", "doctor", "--json"));
  assert.equal(doctor.ok, true);
  assert.deepEqual(doctor.pluginErrors, []);
  assert.deepEqual(doctor.diagnostics, []);
  for (const id of ["codex", "lobster"]) {
    const plugin = plugins.find((item) => item.id === id);
    assert.equal(plugin?.status, "loaded");
    assert.equal(plugin?.version, "2026.9.4");
  }
  for (const enabled of [false, true]) {
    nativeCommand("plugins", enabled ? "enable" : "disable", "lobster");
    const observed = JSON.parse(
      nativeCommand("plugins", "list", "--json"),
    ).plugins;
    assert.equal(
      observed.find((plugin) => plugin.id === "lobster")?.status,
      enabled ? "loaded" : "disabled",
    );
    assert.equal(
      observed.find((plugin) => plugin.id === "codex")?.status,
      "loaded",
    );
  }
  for (const enabled of [true, false, true]) {
    nativeCommand(
      "config",
      "set",
      "skills.entries.clawscarf-probe.enabled",
      String(enabled),
    );
    const skills = JSON.parse(nativeCommand("skills", "list", "--json")).skills;
    const skill = skills.find((entry) => entry.name === "clawscarf-probe");
    assert.equal(skill?.disabled, !enabled);
    assert.equal(skill?.eligible, enabled);
  }
  const retained = JSON.parse(await readFile(file, "utf8"));
  assert.equal(retained.agents.defaults.workspace, workspace);
  assert.equal(
    retained.plugins.entries.codex.config.sessionCatalog.enabled,
    false,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.log(
  "Native plugin/skill controls, Codex version and Lobster pipeline passed.",
);
