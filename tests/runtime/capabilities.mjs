import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
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
const file = `/tmp/clawscarf-capabilities-${process.pid}.json`;
try {
  await writeFile(
    file,
    JSON.stringify({
      gateway: { mode: "local" },
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
  const native = spawnSync(
    "node",
    ["/app/openclaw.mjs", "plugins", "list", "--json"],
    { encoding: "utf8", env: { ...process.env, OPENCLAW_CONFIG_PATH: file } },
  );
  assert.equal(native.status, 0);
  const plugins = JSON.parse(native.stdout).plugins;
  for (const id of ["codex", "lobster"]) {
    const plugin = plugins.find((item) => item.id === id);
    assert.equal(plugin?.status, "loaded");
    assert.equal(plugin?.version, "2026.9.4");
  }
} finally {
  await unlink(file);
}
console.log(
  "Native plugin loading, Codex version and Lobster pipeline passed.",
);
