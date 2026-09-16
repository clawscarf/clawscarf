import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import { runtimeDependencies } from "./dependencies.js";

/** Preserve locked versions while limiting runtime installs to the executable import closure. */
export async function writeRuntimePackage(
  root: string,
  stage: string,
  entrypoints: readonly string[],
  metadata: { name: string; scripts?: Record<string, string> },
) {
  const source = z
    .object({
      version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
      engines: z.record(z.string(), z.string()),
      packageManager: z.string(),
      dependencies: z.record(z.string(), z.string()),
    })
    .parse(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
  // Runtime code may import its package version; stage that generated input first.
  await writeFile(join(stage, "package.json"), JSON.stringify(source) + "\n");
  const required = await runtimeDependencies(stage, entrypoints);
  const dependencies: Record<string, string> = {};
  for (const name of [...required].sort()) {
    const version = source.dependencies[name];
    if (!version)
      throw Error(`Runtime import lacks a production dependency: ${name}`);
    dependencies[name] = version;
  }
  const manifest = {
    ...source,
    ...metadata,
    dependencies,
    private: true,
    type: "module",
    license: "MIT",
  };
  const lock = parseDocument(
    await readFile(join(root, "pnpm-lock.yaml"), "utf8"),
  );
  if (lock.errors.length) throw Error("Invalid runtime source lockfile.");
  for (const name of Object.keys(source.dependencies))
    if (!required.has(name))
      lock.deleteIn(["importers", ".", "dependencies", name]);
  lock.deleteIn(["importers", ".", "devDependencies"]);
  await writeFile(
    join(stage, "package.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(join(stage, "pnpm-lock.yaml"), lock.toString());
  return manifest;
}
