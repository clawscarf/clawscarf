import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { NativeClaws } from "../../scripts/packs/native.js";
import {
  activatePacks,
  selectionSchema,
} from "../../scripts/installation/packs.js";
import { openPack } from "../../scripts/packs/source.js";
import { initializeState } from "../../scripts/deployment/state.js";
import { parseLocalInput } from "../../scripts/deployment/configuration.js";
class Fixture extends NativeClaws {
  mutations = 0;
  fail = false;
  constructor() {
    super("unused");
  }
  override version() {
    return Promise.resolve();
  }
  override defaultModel() {
    return Promise.resolve("clawscarf/team");
  }
  override run(args: readonly string[]) {
    if (args.includes("--yes")) {
      this.mutations++;
      if (this.fail) return Promise.reject(Error("Response lost"));
    }
    return Promise.resolve({
      stability: "experimental",
      schemaVersion:
        args[1] === "remove"
          ? "openclaw.clawRemovePlan.v1"
          : args[1] === "update"
            ? "openclaw.clawUpdatePlan.v1"
            : "openclaw.clawAddPlan.v1",
      planIntegrity: "sha256:" + "a".repeat(64),
      summary: { blockedActions: 0 },
    });
  }
}
for (const uncertain of [false, true])
  await test(`pack startup preserves ${uncertain ? "uncertain outcomes" : "completed native edits"} and does not replay`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "cs-packs-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "state"),
      pack = join(root, "pack");
    await cp(resolve("packs/research-team"), pack, { recursive: true });
    await initializeState(
      directory,
      parseLocalInput({
        name: "test",
        administratorName: "Owner",
        runtimeImage: `sha256:${"a".repeat(64)}`,
        companionImage: `sha256:${"a".repeat(64)}`,
        openshellCli: "/tmp/unused",
        openshellGateway: "/tmp/unused",
        openshellClientImage: `sha256:${"a".repeat(64)}`,
        ports: {
          controller: 17671,
          application: 18800,
          widgets: 18802,
          management: 18801,
          native: 18789,
          nativeWidgets: 18790,
          database: 15432,
        },
        cpu: "1",
        memory: "1Gi",
      }),
    );
    await writeFile(
      join(directory, "packs.json"),
      JSON.stringify({
        python: "/unused",
        packs: [
          {
            directory: pack,
            digest: (await openPack(pack)).digest,
            members: ["researcher"],
          },
        ],
      }),
    );
    const native = new Fixture();
    native.fail = uncertain;
    const first = await activatePacks(directory, () => undefined, native);
    assert.deepEqual(first, [
      { member: "researcher", state: uncertain ? "unconfirmed" : "complete" },
    ]);
    assert.equal(native.mutations, 1);
    assert.deepEqual(
      await activatePacks(directory, () => undefined, native),
      first,
    );
    assert.equal(native.mutations, 1);
    if (!uncertain) {
      const selection = selectionSchema.parse(
        JSON.parse(await readFile(join(directory, "packs.json"), "utf8")),
      );
      // A new source revision invokes the native update operator once.
      await writeFile(join(pack, "README.md"), "Reviewed pack revision\n");
      const selected = selection.packs[0];
      assert.ok(selected);
      selected.digest = (await openPack(pack)).digest;
      await writeFile(join(directory, "packs.json"), JSON.stringify(selection));
      assert.deepEqual(
        await activatePacks(directory, () => undefined, native),
        first,
      );
      assert.equal(native.mutations, 2);
      await writeFile(
        join(directory, "packs.json"),
        JSON.stringify({ python: "/unused", packs: [] }),
      );
      assert.deepEqual(
        await activatePacks(directory, () => undefined, native),
        first,
      );
      assert.equal(native.mutations, 3);
      assert.deepEqual(
        await activatePacks(directory, () => undefined, native),
        [],
      );
      assert.equal(native.mutations, 3);
      return;
    }
    // Normal restart neither requires the original source nor restores deleted/edited native agents.
    await rm(pack, { recursive: true });
    const again = await activatePacks(directory, () => undefined, native);
    assert.deepEqual(again, first);
    assert.equal(native.mutations, 1);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, "pack-status.json"), "utf8")),
      first,
    );
  });
