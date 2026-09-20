import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { releaseSchema, releaseTools } from "./release/definition.js";
import { createDevelopmentRelease } from "./release/create.js";
import { setupContext, recipeConfiguration } from "./installation/setup.js";
import { verifyReleaseTool } from "./installation/files.js";
import {
  installationCatalog,
  readRecipe,
} from "./installation/recipes/catalog.js";
import { postgresImage } from "./deployment/images.js";

await test("runtime artifacts relocate independently of recipes and reject altered tools", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "tool"), "executable fixture", {
    mode: 0o755,
  });
  const image = `sha256:${"a".repeat(64)}`;
  const input = {
    schemaVersion: 1,
    version: "0.1.0-test",
    sourceRevision: "a".repeat(40),
    platforms: ["darwin-arm64"],
    images: {
      postgres: postgresImage,
      gateway: image,
      companion: image,
      openshellClient: image,
    },
    tools: { openshell: { version: "0.0.116", cli: "tool", gateway: "tool" } },
  };
  const options = {
    inputFile: join(directory, "input.json"),
    outputDirectory: join(directory, "bundle"),
  };
  await writeFile(options.inputFile, JSON.stringify(input));
  const release = await createDevelopmentRelease(options);
  await assert.rejects(createDevelopmentRelease(options), { code: "EEXIST" });
  assert.deepEqual(
    await createDevelopmentRelease({
      ...options,
      outputDirectory: join(directory, "second"),
    }),
    release,
  );
  assert.equal("recipes" in release, false);
  assert.equal("packs" in release, false);
  assert.equal("modelCatalog" in release, false);
  assert.throws(() => releaseSchema.parse({ ...release, recipes: [] }));
  const moved = join(directory, "moved");
  await rename(options.outputDirectory, moved);
  await rm(join(directory, "tool"));
  const tool = releaseTools(release, "darwin-arm64").cli;
  await verifyReleaseTool(join(moved, tool.file), tool.sha256);
  assert.ok(!JSON.stringify(release).includes(directory));
  if (process.platform === "darwin" && process.arch === "arm64") {
    const recipe = await readRecipe(resolve("recipes/team-server/recipe.json"));
    const file = join(directory, "recipe.json");
    await writeFile(
      file,
      JSON.stringify({
        ...recipe,
        runtime: "./moved/clawscarf-release.json",
        packs: [{ id: "research-team", members: ["researcher"] }],
      }),
    );
    const context = await setupContext({ recipe: file });
    assert.equal(context.release.version, release.version);
    assert.equal(
      recipeConfiguration(context, recipe.id).recipe?.version,
      recipe.version,
    );
    assert.equal(
      recipeConfiguration(context, recipe.id).packs[0]?.directory,
      resolve("packs/research-team"),
    );
  }
  await writeFile(join(moved, tool.file), "modified");
  await assert.rejects(verifyReleaseTool(join(moved, tool.file), tool.sha256));
  assert.deepEqual(
    JSON.parse(await readFile(join(moved, "clawscarf-release.json"), "utf8")),
    release,
  );
});

await test("bundled recipes pin a runtime and validate their editable defaults", async () => {
  const catalog = await installationCatalog();
  const recipe = catalog.recipes.find((item) => item.id === "team-server");
  assert.ok(recipe);
  assert.equal(recipe.version, "0.1.0");
  assert.equal(recipe.name, "Team server");
  assert.equal(recipe.defaults.connections?.enabled, true);
  assert.deepEqual(recipe.models, {
    model: "gpt-6-astra",
    provider: "openai",
    reasoning: "medium",
  });
  assert.equal(
    releaseSchema.parse(JSON.parse(await readFile(recipe.runtime, "utf8")))
      .version,
    "0.1.0-dev",
  );
});

await test("release browser capability requires its complete browser and relay image set", () => {
  const image = `sha256:${"a".repeat(64)}`;
  const base = {
    postgres: postgresImage,
    gateway: image,
    companion: image,
    openshellClient: image,
  };
  const browser = { chromium: image, node: image, dns: image, egress: image };
  const schema = releaseSchema.shape.images;
  schema.parse(base);
  schema.parse({ ...base, browser, relay: image });
  assert.throws(() => schema.parse({ ...base, browser }), /supplied together/);
  assert.throws(
    () => schema.parse({ ...base, relay: image }),
    /supplied together/,
  );
});

await test("release tools select exact host artifacts and reject incomplete cross-platform bundles", () => {
  const tool = (host: string) => ({
    file: `tools/${host}/openshell`,
    sha256: "a".repeat(64),
  });
  const release = releaseSchema.parse({
    schemaVersion: 1,
    version: "0.1.0-test",
    sourceRevision: "a".repeat(40),
    platforms: ["darwin-arm64", "linux-arm64", "linux-x64"],
    images: {
      postgres: postgresImage,
      gateway: `sha256:${"a".repeat(64)}`,
      companion: `sha256:${"a".repeat(64)}`,
      openshellClient: `sha256:${"a".repeat(64)}`,
    },
    tools: {
      openshell: {
        version: "0.0.116",
        cli: {
          "darwin-arm64": tool("darwin-arm64"),
          "linux-arm64": tool("linux-arm64"),
          "linux-x64": tool("linux-x64"),
        },
        gateway: {
          "darwin-arm64": tool("darwin-arm64"),
          "linux-arm64": tool("linux-arm64"),
          "linux-x64": tool("linux-x64"),
        },
      },
    },
  });
  for (const host of release.platforms)
    assert.equal(
      releaseTools(release, host).cli.file,
      `tools/${host}/openshell`,
    );
  assert.throws(() => releaseTools(release, "win32-x64"));
  assert.throws(
    () =>
      releaseTools(
        {
          ...release,
          tools: { openshell: { ...release.tools.openshell, cli: {} } },
        },
        "linux-x64",
      ),
    /Missing runtime tool/,
  );
  assert.throws(
    () =>
      releaseTools(
        {
          ...release,
          tools: {
            openshell: {
              ...release.tools.openshell,
              cli: tool("darwin-arm64"),
            },
          },
        },
        "linux-x64",
      ),
    /Multi-platform/,
  );
});
