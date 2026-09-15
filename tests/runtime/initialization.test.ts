import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeHome } from "../../runtime/initialize.js";
await test("native volume initialization preserves edits and refuses foreign state", async () => {
  const parent = await mkdtemp(join(tmpdir(), "clawscarf-home-"));
  try {
    const home = join(parent, "home");
    const value = {
      ownerId: "00000000-0000-4000-8000-000000000001",
      serverId: "00000000-0000-4000-8000-000000000002",
      configuration: "{}",
    };
    await initializeHome(
      home,
      value,
      process.getuid?.() ?? 1000,
      process.getgid?.() ?? 1000,
    );
    await writeFile(join(home, ".openclaw/openclaw.json"), "human edit");
    await initializeHome(
      home,
      value,
      process.getuid?.() ?? 1000,
      process.getgid?.() ?? 1000,
    );
    assert.equal(
      await readFile(join(home, ".openclaw/openclaw.json"), "utf8"),
      "human edit",
    );
    await assert.rejects(
      initializeHome(
        home,
        { ...value, ownerId: "00000000-0000-4000-8000-000000000003" },
        1000,
        1000,
      ),
    );
    const foreign = join(parent, "foreign");
    await mkdir(join(foreign, ".openclaw"), { recursive: true });
    await writeFile(join(foreign, ".openclaw/openclaw.json"), "{} ");
    await assert.rejects(initializeHome(foreign, value, 1000, 1000));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
