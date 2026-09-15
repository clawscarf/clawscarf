import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { startProcess } from "../../scripts/local/supervisor.js";

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    await delay(25);
  }
  throw Error("Child did not become ready.");
}

await test("supervisor stops an owned subprocess tree, including a descendant that ignores SIGTERM", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-supervisor-"));
  const ready = join(directory, "ready");
  const heartbeat = join(directory, "heartbeat");
  const worker = `const fs=require('node:fs'); process.on('SIGTERM',()=>{}); fs.writeFileSync(${JSON.stringify(ready)},String(process.pid)); setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),20);`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(worker)}],{stdio:'inherit'}); setInterval(()=>{},1000);`;
  const processTree = await startProcess(process.execPath, ["-e", parent], {
    logFile: join(directory, "output.log"),
  });
  try {
    const pid = Number(await waitForFile(ready));
    assert.ok(pid > 0);
    await waitForFile(heartbeat);
    const [first, second] = await Promise.all([
      processTree.stop(),
      processTree.stop(),
    ]);
    assert.deepEqual(first, second);
    assert.equal(first.kind, "exited");
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    const stopped = await readFile(heartbeat, "utf8");
    await delay(75);
    assert.equal(await readFile(heartbeat, "utf8"), stopped);
    assert.equal(
      (await stat(join(directory, "output.log"))).mode & 0o777,
      0o600,
    );
  } finally {
    await processTree.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

await test("early nonzero exit resolves a safe result and missing executable rejects without leaking arguments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-supervisor-"));
  try {
    const running = await startProcess(
      process.execPath,
      ["-e", "console.error('private detail'); process.exit(7)"],
      { logFile: join(directory, "output.log") },
    );
    assert.deepEqual(await running.done, {
      kind: "exited",
      code: 7,
      signal: null,
    });
    assert.match(
      await readFile(join(directory, "output.log"), "utf8"),
      /private detail/,
    );
    await assert.rejects(
      startProcess(join(directory, "absent"), ["secret argument"], {
        logFile: join(directory, "missing.log"),
      }),
      (error: unknown) =>
        error instanceof Error && !error.message.includes("secret argument"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("unexpected leader exit also cleans up its remaining descendant", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-supervisor-"));
  const ready = join(directory, "ready");
  const worker = `process.on('SIGTERM',()=>{}); require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid)); process.stdout.write('ready'); setInterval(()=>{},1000);`;
  const parent = `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(worker)}],{stdio:['ignore','pipe','inherit']}); child.stdout.once('data',()=>process.exit(4));`;
  const running = await startProcess(process.execPath, ["-e", parent], {
    logFile: join(directory, "output.log"),
  });
  try {
    const pid = Number(await waitForFile(ready));
    assert.deepEqual(await running.done, {
      kind: "exited",
      code: 4,
      signal: null,
    });
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    await running.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

await test("supervisor rejects unsafe existing logs and does not follow symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-supervisor-"));
  try {
    const target = join(directory, "target");
    await writeFile(target, "keep", { mode: 0o644 });
    await symlink(target, join(directory, "link"));
    await assert.rejects(
      startProcess(process.execPath, ["-e", "process.exit(0)"], {
        logFile: target,
      }),
    );
    await assert.rejects(
      startProcess(process.execPath, ["-e", "process.exit(0)"], {
        logFile: join(directory, "link"),
      }),
    );
    assert.equal(await readFile(target, "utf8"), "keep");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
