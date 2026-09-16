import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDevelopmentRelease } from "./release/create.js";
import { loadRecipes } from "./installation/recipes/load.js";
import { liteLlmImage, postgresImage } from "./local/images.js";

await test("release creation accepts only release inputs and hashes tools relative to its input", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "tool"), "executable fixture");
  const input = {
    schemaVersion: 1,
    version: "0.1.0-dev",
    sourceRevision: "a".repeat(40),
    platforms: ["darwin-arm64"],
    recipes: await loadRecipes("deploy/recipes"),
    images: {
      postgres: postgresImage,
      models: liteLlmImage,
      ...Object.fromEntries(
        ["gateway", "worker", "companion", "relay"].map((key) => [
          key,
          "sha256:" + "a".repeat(64),
        ]),
      ),
    },
    tools: { openshell: { version: "0.0.116", cli: "tool", gateway: "tool" } },
  };
  const options = {
    inputFile: join(directory, "input.json"),
    outputFile: join(directory, "release.json"),
  };
  await writeFile(options.inputFile, JSON.stringify(input));
  const release = await createDevelopmentRelease(options);
  assert.deepEqual(release.tools.openshell.cli, {
    file: join(directory, "tool"),
    sha256: createHash("sha256").update("executable fixture").digest("hex"),
  });
  assert.deepEqual(
    JSON.parse(await readFile(options.outputFile, "utf8")),
    release,
  );
  await assert.rejects(createDevelopmentRelease(options), { code: "EEXIST" });
  await writeFile(
    options.inputFile,
    JSON.stringify({ ...input, administratorName: "Not a build input" }),
  );
  await assert.rejects(createDevelopmentRelease(options), { name: "ZodError" });
});
