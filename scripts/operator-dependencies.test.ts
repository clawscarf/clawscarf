import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runtimeDependencies } from "./release/dependencies.js";

await test("operator staging verifies actual imports and derives only used external dependencies", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "runtime"));
  await writeFile(
    join(root, "models.js"),
    'import {contract} from "./runtime/model-contract.js"; export { z } from "zod"; import "node:fs"; await import("@clack/prompts"); // import "not-real"',
  );
  await assert.rejects(
    runtimeDependencies(root, ["models.js"]),
    /Missing runtime import: models.js -> .\/runtime\/model-contract.js/,
  );
  await writeFile(
    join(root, "runtime/model-contract.js"),
    "export const contract = true;",
  );
  assert.deepEqual(
    [...(await runtimeDependencies(root, ["models.js"]))].sort(),
    ["@clack/prompts", "zod"],
  );
  await writeFile(join(root, "remote-helper.js"), "await import(runtimeSdk)");
  assert.deepEqual(
    [...(await runtimeDependencies(root, ["models.js"]))].sort(),
    ["@clack/prompts", "zod"],
  );
  await writeFile(
    join(root, "runtime/model-contract.js"),
    "await import(computedPath)",
  );
  await assert.rejects(
    runtimeDependencies(root, ["models.js"]),
    /verifiable target/,
  );
  await writeFile(
    join(root, "runtime/model-contract.js"),
    'export * from "../../outside.js"',
  );
  await assert.rejects(
    runtimeDependencies(root, ["models.js"]),
    /Missing runtime import/,
  );
});
