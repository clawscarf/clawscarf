import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  readState,
  resourceNames,
  withInstallationLock,
} from "../../scripts/deployment/state.js";
import {
  ensureRuntime,
  stopRuntime,
} from "../../scripts/deployment/runtime.js";
import { run } from "../../scripts/deployment/process.js";

const configured = process.env.CLAWSCARF_TEST_LOCAL_ALLOCATION_DIRECTORY;
await test(
  "real allocation survives a process crash before its local receipt without creating twice",
  {
    skip: !configured,
    timeout: 240000,
  },
  async () => {
    assert.ok(configured);
    const directory = resolve(configured);
    const state = await readState(directory);
    z.strictObject({ ownerId: z.literal(state.ownerId) }).parse(
      JSON.parse(await readFile(join(directory, "prepared.json"), "utf8")),
    );
    const name = resourceNames(state).sandbox;
    const controller = join(directory, "controller");
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: join(controller, "config"),
      XDG_STATE_HOME: join(controller, "state"),
      XDG_DATA_HOME: join(controller, "data"),
    };
    const targets = z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        labels: z.record(z.string(), z.string()),
      }),
    );
    async function inventory() {
      return targets.parse(
        JSON.parse(
          await run(
            state.input.openshellCli,
            [
              "sandbox",
              "list",
              "--limit",
              "100",
              "-o",
              "json",
              "--gateway",
              name,
              "--workspace",
              "default",
            ],
            { env },
          ),
        ),
      );
    }
    await withInstallationLock(directory, async () => {
      // This opt-in test must never adopt or interrupt an existing installation runtime.
      for (const file of ["runtime-create.json", "runtime.json"])
        await assert.rejects(lstat(join(directory, file)), { code: "ENOENT" });
      assert.deepEqual(
        await inventory(),
        [],
        "Use a fresh isolated controller with no runtimes.",
      );
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(
            new URL("./allocation-crash-fixture.ts", import.meta.url),
          ),
          directory,
        ],
        { env, stdio: "ignore" },
      );
      const outcome = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      assert.equal(outcome.signal, "SIGKILL");
      assert.equal(outcome.code, null);
      assert.ok((await lstat(join(directory, "runtime-create.json"))).isFile());
      await assert.rejects(lstat(join(directory, "runtime.json")), {
        code: "ENOENT",
      });
      const allocated = await inventory();
      assert.equal(allocated.length, 1);
      const target = allocated[0];
      assert.ok(target);
      assert.equal(target.name, name);
      assert.equal(target.labels["clawscarf.installation"], state.ownerId);
      const resumed = await ensureRuntime(
        directory,
        state,
        env,
        (executable, args, options) => {
          assert.notEqual(
            args[1],
            "create",
            "Resumption must observe the real runtime, not allocate again.",
          );
          return run(executable, args, options);
        },
      );
      assert.equal(resumed.id, target.id);
      const receipt = z
        .object({ id: z.uuid(), ownerId: z.uuid() })
        .parse(
          JSON.parse(await readFile(join(directory, "runtime.json"), "utf8")),
        );
      assert.equal(receipt.id, target.id);
      assert.equal(receipt.ownerId, state.ownerId);
      assert.deepEqual(
        (await inventory()).map((row) => row.id),
        [target.id],
      );
      await stopRuntime(directory, state, env);
      assert.deepEqual(
        (await inventory()).map((row) => row.id),
        [target.id],
      );
    });
  },
);
