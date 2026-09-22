import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import {
  readdir,
  readFile,
  access,
  mkdtemp,
  writeFile,
  rm,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const inventory = JSON.parse(await readFile("/tmp/inventory.json", "utf8"));
const sorted = (values) => [...values].sort();
const pluginRoots = ["/app/extensions", "/app/dist/extensions"];
for (const root of pluginRoots) {
  const ids = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = JSON.parse(
      await readFile(join(root, entry.name, "openclaw.plugin.json"), "utf8"),
    );
    ids.push(manifest.id);
  }
  assert.deepEqual(sorted(ids), inventory.bundledPlugins, root);
}
const skills = [];
async function skillNames(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Plugin collections also contain attribution directories, such as Slack's _vendor.
    if (!(await readdir(join(root, entry.name))).includes("SKILL.md")) continue;
    await access(join(root, entry.name, "SKILL.md"));
    skills.push(entry.name);
  }
}
await skillNames("/app/skills");
for (const plugin of inventory.bundledPlugins) {
  const root = `/app/dist/extensions/${plugin}`;
  const manifest = JSON.parse(
    await readFile(join(root, "openclaw.plugin.json"), "utf8"),
  );
  for (const skillRoot of manifest.skills ?? [])
    await skillNames(join(root, skillRoot));
}
assert.deepEqual(sorted(skills), inventory.bundledSkills);
const additionalRoots = [
  "/app/clawscarf/access",
  "/app/clawscarf/connections",
  "/app/clawscarf/native-plugins/node_modules/@openclaw/lobster",
];
const additionalIds = [];
for (const root of additionalRoots) {
  const manifest = JSON.parse(
    await readFile(join(root, "openclaw.plugin.json"), "utf8"),
  );
  additionalIds.push(manifest.id);
  for (const skillRoot of manifest.skills ?? [])
    await skillNames(join(root, skillRoot));
}
assert.deepEqual(sorted(additionalIds), inventory.additionalPlugins);
assert.deepEqual(
  sorted(skills),
  sorted([...inventory.bundledSkills, ...inventory.additionalSkills]),
);
await access(
  "/app/dist/extensions/document-extract/document-extractor.worker.js",
);
await access("/app/dist/extensions/browser/runtime-api.js");
await access(
  "/app/dist/extensions/memory-core/session-search-visibility-api.js",
);

const home = await mkdtemp(join(tmpdir(), "clawscarf-inventory-"));
try {
  const file = join(home, "openclaw.json");
  await writeFile(
    file,
    JSON.stringify({
      gateway: { mode: "local" },
      plugins: {
        allow: ["codex", "lobster"],
        load: { paths: additionalRoots },
      },
    }),
  );
  const result = spawnSync(
    "node",
    ["/app/openclaw.mjs", "plugins", "list", "--json"],
    {
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: home,
        OPENCLAW_STATE_DIR: join(home, "state"),
        OPENCLAW_CONFIG_PATH: file,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const discovery = JSON.parse(result.stdout);
  assert.deepEqual(discovery.diagnostics, []);
  assert.deepEqual(
    sorted(discovery.plugins.map((p) => p.id)),
    sorted([...inventory.bundledPlugins, ...inventory.additionalPlugins]),
  );
  console.log(
    "Curated files and native plugin discovery match the distribution inventory.",
  );
} finally {
  await rm(home, { recursive: true, force: true });
}
