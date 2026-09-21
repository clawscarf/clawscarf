import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { nodeEntrypoint } from "../../scripts/deployment/entrypoint.js";

const execute = promisify(execFile);

await test("controller setup launches from outside the contributor checkout", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "clawscarf-controller-entry-"),
  );
  try {
    const { stdout } = await execute(
      process.execPath,
      [...nodeEntrypoint("../controller"), "init", "--help"],
      { cwd: directory, timeout: 30_000 },
    );
    assert.match(stdout, /Usage: clawscarf-controller init/);
    assert.match(stdout, /--gateway <path>/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
