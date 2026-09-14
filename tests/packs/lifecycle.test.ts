import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cp,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NativeClaws } from "../../scripts/packs/native.js";
import { planPack, applyPack } from "../../scripts/packs/lifecycle.js";
import { openPack } from "../../scripts/packs/source.js";
import { packSchema } from "../../scripts/packs/model.js";
class FixtureClaws extends NativeClaws {
  calls: readonly string[][] = [];
  model = "litellm/team-model";
  constructor(supportsConnectionBindings = true) {
    super("unused", supportsConnectionBindings);
  }
  override version() {
    return Promise.resolve();
  }
  override defaultModel() {
    if (!this.model) throw Error("Provider credential is unavailable.");
    return Promise.resolve(this.model);
  }
  override run(args: string[]) {
    this.calls = [...this.calls, args];
    return Promise.resolve({
      stability: "experimental",
      schemaVersion: "openclaw.clawAddPlan.v1",
      planIntegrity: "sha256:" + "a".repeat(64),
      summary: { blockedActions: 0 },
    });
  }
}
await test("pack apply rejects changed source and actual model readiness instead of accepting flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-pack-plan-"));
  try {
    await cp(resolve("packs/research-team"), directory, { recursive: true });
    const native = new FixtureClaws();
    const input = {
      directory,
      operation: "add" as const,
      member: "researcher",
      workspace: join(directory, "unused-workspace"),
    };
    const plan = await planPack(input, native);
    assert.equal(plan.requirements.model, "litellm/team-model");
    native.model = "litellm/other-model";
    await assert.rejects(applyPack(plan, native), /requirements changed/);
    assert.equal(
      native.calls.some((args) => args.includes("--yes")),
      false,
    );
    native.model = "";
    await assert.rejects(planPack(input, native), /credential is unavailable/);
    native.model = "litellm/team-model";
    const path = join(directory, "researcher/CLAW.md");
    await writeFile(
      path,
      (await readFile(path, "utf8")) + "\nChanged prompt\n",
    );
    await assert.rejects(applyPack(plan, native), /sources changed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
await test("pack source rejects symlinks instead of following files outside package", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-pack-link-"));
  try {
    await cp(resolve("packs/research-team"), directory, { recursive: true });
    await symlink("/etc/passwd", join(directory, "linked"));
    await assert.rejects(openPack(directory), /linked files/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("packaged runtime rejects connection bindings before reading operator credentials or changing native state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-pack-connection-"));
  try {
    await cp(resolve("packs/research-team"), directory, { recursive: true });
    const manifestPath = join(directory, "pack.json");
    const manifest = packSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
    assert.ok(manifest.members[0]);
    manifest.members[0].requirements.connections.push({
      slot: "documents",
      connectorId: "googledrive",
    });
    await writeFile(manifestPath, JSON.stringify(manifest));
    const native = new FixtureClaws(false);
    await assert.rejects(
      planPack(
        {
          directory,
          operation: "add",
          member: "researcher",
          workspace: join(directory, "workspace"),
          bindingsFile: "/missing/administrator-session",
        },
        native,
      ),
      /operator-side verification/,
    );
    assert.deepEqual(native.calls, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
