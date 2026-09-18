import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { releaseSchema } from "./release/definition.js";
import { createDevelopmentRelease } from "./release/create.js";
import { loadRecipes } from "./installation/recipes/load.js";
import { setupContext, recipeConfiguration } from "./installation/setup.js";
import { verifyReleasePacks } from "./release/packs.js";
import { liteLlmImage, postgresImage } from "./deployment/images.js";

await test("release bundles survive relocation without source files and reject missing or altered payloads", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "tool"), "executable fixture");
  await chmod(join(directory, "tool"), 0o755);
  await cp("packs/research-team", join(directory, "source-pack"), {
    recursive: true,
  });
  const recipes = await loadRecipes("deploy/recipes");
  assert.ok(recipes[0]);
  recipes[0].packs = [
    { id: "research-team", members: ["researcher", "reviewer"] },
  ];
  const input = {
    schemaVersion: 1,
    version: "0.1.0-dev",
    sourceRevision: "a".repeat(40),
    platforms: ["darwin-arm64"],
    recipes,
    packs: ["source-pack"],
    images: {
      postgres: postgresImage,
      models: liteLlmImage,
      ...Object.fromEntries(
        ["gateway", "companion", "openshellClient"].map((key) => [
          key,
          "sha256:" + "a".repeat(64),
        ]),
      ),
    },
    tools: { openshell: { version: "0.0.116", cli: "tool", gateway: "tool" } },
  };
  const options = {
    inputFile: join(directory, "input.json"),
    outputDirectory: join(directory, "bundle"),
  };
  await writeFile(options.inputFile, JSON.stringify(input));
  const release = await createDevelopmentRelease(options);
  assert.deepEqual(release.tools.openshell.cli, {
    file: "tools/openshell",
    sha256: createHash("sha256").update("executable fixture").digest("hex"),
  });
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(options.outputDirectory, "clawscarf-release.json"),
        "utf8",
      ),
    ),
    release,
  );
  await assert.rejects(createDevelopmentRelease(options), { code: "EEXIST" });
  const second = { ...options, outputDirectory: join(directory, "second") };
  assert.deepEqual(
    await createDevelopmentRelease(second),
    release,
    "Repeated builds have identical metadata/digests",
  );
  await writeFile(options.inputFile, JSON.stringify({ ...input, packs: [] }));
  const broken = { ...options, outputDirectory: join(directory, "broken") };
  await assert.rejects(
    createDevelopmentRelease(broken),
    /requires missing pack/,
  );
  await assert.rejects(
    readFile(join(broken.outputDirectory, "clawscarf-release.json")),
    { code: "ENOENT" },
  );
  await writeFile(
    options.inputFile,
    JSON.stringify({ ...input, administratorName: "Not a build input" }),
  );
  await assert.rejects(createDevelopmentRelease(options), { name: "ZodError" });
  const moved = join(directory, "moved");
  await rename(options.outputDirectory, moved);
  for (const name of ["tool", "source-pack", "input.json"])
    await rm(join(directory, name), { recursive: true });
  const releaseFile = join(moved, "clawscarf-release.json");
  await verifyReleasePacks(release, releaseFile);
  assert.equal(
    await readFile(join(moved, release.tools.openshell.cli.file), "utf8"),
    "executable fixture",
  );
  assert.ok(
    !JSON.stringify(release).includes(directory),
    "No build-machine paths escape into metadata",
  );
  if (process.platform === "darwin" && process.arch === "arm64") {
    const context = await setupContext({ release: releaseFile });
    const config = recipeConfiguration(context, "team-documents");
    assert.deepEqual(config.packs, [
      {
        directory: resolve(moved, "packs/research-team"),
        members: ["researcher", "reviewer"],
      },
    ]);
  }
  await writeFile(
    join(moved, "packs/research-team/researcher/CLAW.md"),
    "changed",
  );
  await assert.rejects(
    verifyReleasePacks(release, releaseFile),
    /does not match its digest/,
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
