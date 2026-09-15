import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import lobster from "/app/clawscarf/native-plugins/node_modules/@openclaw/lobster/dist/index.js";
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
    "/app/clawscarf/native-plugins/node_modules/@openai/codex/bin/codex.js",
    "--version",
  ],
  { encoding: "utf8" },
);
assert.equal(codex.status, 0);
assert.equal(codex.stdout.trim(), "codex-cli 0.153.4");
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
            "/app/clawscarf/native-plugins/node_modules/@openclaw/codex",
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
  const plugins = JSON.parse(
    nativeCommand("plugins", "list", "--json"),
  ).plugins;
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
