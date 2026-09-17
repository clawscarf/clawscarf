import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { resolve, join } from "node:path";
import { z } from "zod";
import { readState, resourceNames } from "../../scripts/deployment/state.js";
import { readUpgrade } from "../../scripts/deployment/upgrade-state.js";
import { upgradeLocal } from "../../scripts/deployment/upgrade.js";
import { verifyRuntimeBinding } from "../../scripts/deployment/runtime-binding.js";
import { runtimeManager } from "../../scripts/deployment/runtime.js";
import { run } from "../../scripts/deployment/process.js";

const execute = promisify(execFile);
const directoryInput = process.env["CLAWSCARF_TEST_LOCAL_UPGRADE_DIRECTORY"];
const image = process.env["CLAWSCARF_TEST_LOCAL_UPGRADE_IMAGE"];
const python = process.env["CLAWSCARF_TEST_LOCAL_UPGRADE_PYTHON"];
await test(
  "real replacement resumes after a crash before settings restore and retains native home",
  {
    skip: !directoryInput || !image || !python,
    timeout: 300000,
  },
  async () => {
    assert.ok(directoryInput && image && python);
    const directory = resolve(directoryInput);
    const before = await readState(directory);
    assert.equal(
      await readUpgrade(directory),
      undefined,
      "Use a disposable installation without an earlier upgrade.",
    );
    assert.notEqual(image, before.input.runtimeImage);
    const names = resourceNames(before);
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: join(directory, "controller/config"),
      XDG_STATE_HOME: join(directory, "controller/state"),
      XDG_DATA_HOME: join(directory, "controller/data"),
    };
    const control = runtimeManager(directory, before, env, run);
    const recorded = await control.recorded();
    assert.ok(recorded.receipt);
    assert.equal((await control.confirm(recorded.receipt.id)).phase, "Stopped");
    await verifyRuntimeBinding(before, recorded.receipt);
    const fingerprint = () =>
      run("docker", [
        "run",
        "--rm",
        "--network",
        "none",
        "--user",
        "1000",
        "--mount",
        `type=volume,source=${names.volume},target=/home/node,readonly`,
        "--entrypoint",
        "node",
        before.input.runtimeImage,
        "-e",
        'const fs=require("node:fs"),c=require("node:crypto"); console.log(c.createHash("sha256").update(fs.readFileSync("/home/node/.openclaw/openclaw.json")).update(fs.readFileSync("/home/node/upgrade-retention-proof.txt")).digest("hex"));',
      ]);
    // The caller opts into a disposable, stopped installation and starts only its controller.
    await run("docker", [
      "run",
      "--rm",
      "--network",
      "none",
      "--user",
      "1000",
      "--mount",
      `type=volume,source=${names.volume},target=/home/node`,
      "--entrypoint",
      "node",
      before.input.runtimeImage,
      "-e",
      'require("node:fs").writeFileSync("/home/node/upgrade-retention-proof.txt", "ClawScarf upgrade retention\\n");',
    ]);
    const initial = await fingerprint();
    const child = `
    import { upgradeLocal } from './scripts/deployment/upgrade.ts';
    import { run } from './scripts/deployment/process.ts';
    await upgradeLocal(process.env.CLAWSCARF_TEST_LOCAL_UPGRADE_DIRECTORY,
      process.env.CLAWSCARF_TEST_LOCAL_UPGRADE_IMAGE, process.env.CLAWSCARF_TEST_LOCAL_UPGRADE_PYTHON,
      () => {}, async (file, args, options) => {
        if (file === process.env.CLAWSCARF_TEST_LOCAL_UPGRADE_PYTHON && JSON.parse(options.input).action === 'restore')
          process.kill(process.pid, 'SIGKILL');
        return run(file, args, options);
      });
  `;
    await assert.rejects(
      execute(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", child],
        {
          cwd: resolve(import.meta.dirname, "../.."),
          env: process.env,
          timeout: 180000,
        },
      ),
      (error: unknown) =>
        error instanceof Error &&
        "signal" in error &&
        error.signal === "SIGKILL",
    );
    const interrupted = await readUpgrade(directory);
    assert.ok(interrupted?.newId);
    assert.equal(interrupted.stage, "restore_sent");
    const candidate = {
      ...before,
      input: { ...before.input, runtimeImage: image },
    };
    const binding = await verifyRuntimeBinding(candidate, {
      name: names.sandbox,
      id: interrupted.newId,
    });
    // Compute is Ready but the actual application must still be absent behind the gate.
    await run("docker", [
      "exec",
      binding.containerId,
      "node",
      "-e",
      `fetch('http://127.0.0.1:${String(before.input.ports.native)}/healthz', {signal:AbortSignal.timeout(2000)}).then(()=>process.exit(1),()=>process.exit(0));`,
    ]);
    assert.equal(await fingerprint(), initial);
    // SIGKILL leaves a process lock; proper-lockfile's stale interval must expire before explicit resumption.
    const deadline = Date.now() + 15000;
    for (;;) {
      try {
        await upgradeLocal(directory, image, python, () => {});
        break;
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ELOCKED"
          ) ||
          Date.now() >= deadline
        )
          throw error;
        await new Promise((done) => setTimeout(done, 1000));
      }
    }
    const after = await readState(directory);
    const completed = await readUpgrade(directory);
    assert.equal(completed?.stage, "complete");
    assert.equal(completed?.newId, interrupted.newId);
    assert.equal(after.input.runtimeImage, image);
    assert.equal(await fingerprint(), initial);
    const native = z
      .object({ phase: z.literal("Stopped"), id: z.literal(interrupted.newId) })
      .parse(
        JSON.parse(
          await run(
            after.input.openshellCli,
            [
              "sandbox",
              "get",
              names.sandbox,
              "--gateway",
              names.sandbox,
              "--workspace",
              "default",
              "--output",
              "json",
            ],
            {
              env: {
                ...process.env,
                XDG_CONFIG_HOME: join(directory, "controller/config"),
                XDG_STATE_HOME: join(directory, "controller/state"),
                XDG_DATA_HOME: join(directory, "controller/data"),
              },
            },
          ),
        ),
      );
    assert.equal(native.id, interrupted.newId);
  },
);
