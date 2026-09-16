import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { writeRuntimePackage } from "./release/runtime-package.js";

const execute = promisify(execFile);
await test(
  "compiled companion installs only its frozen runtime dependency closure",
  {
    skip: process.env.CLAWSCARF_TEST_COMPANION_PACKAGE !== "1",
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-companion-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    for (const path of ["apps", "services"])
      await cp(join("dist", path), join(directory, path), { recursive: true });
    const manifest = await writeRuntimePackage(
      process.cwd(),
      directory,
      [
        "apps/companion/entry.js",
        "services/access/runtime/migrate.js",
        "services/connections/runtime/migrate.js",
      ],
      { name: "clawscarf-companion" },
    );
    for (const name of ["fastify", "pg", "node-pg-migrate", "zod"])
      assert.ok(manifest.dependencies[name], name);
    for (const name of [
      "react",
      "react-dom",
      "typescript",
      "@clack/prompts",
      "commander",
      "proper-lockfile",
    ])
      assert.equal(manifest.dependencies[name], undefined, name);
    await execute(
      "pnpm",
      ["install", "--prod", "--frozen-lockfile", "--ignore-scripts"],
      {
        cwd: directory,
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    await execute(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'await import("./apps/companion/composition.js")',
      ],
      {
        cwd: directory,
        timeout: 30000,
      },
    );
  },
);
