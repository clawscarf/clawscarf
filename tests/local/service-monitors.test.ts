import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { monitorComposeServices } from "../../scripts/local/service-monitors.js";
import {
  startProcess,
  type ManagedProcess,
} from "../../scripts/local/supervisor.js";

for (const exited of ["models", "models-database"]) {
  await test(`${exited} exit completes a foreground lifetime monitor while the other service runs`, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "clawscarf-service-monitor-"),
    );
    const children: ManagedProcess[] = [];
    try {
      // The fixture replaces Docker only; the production process supervisor owns its lifetime.
      const fixture = join(directory, "compose.mjs");
      await writeFile(
        fixture,
        `import {writeFileSync, existsSync} from 'node:fs'; const service=process.argv.at(-1); writeFileSync(${JSON.stringify(directory)}+'/'+service+'.ready','ready'); setInterval(()=>{if(existsSync(${JSON.stringify(directory)}+'/'+service+'.exit'))process.exit(0)},10);`,
      );
      await monitorComposeServices(
        directory,
        ["models", "models-database"],
        async (executable, args, log) => {
          assert.equal(executable, "docker");
          const service = args.at(-1);
          assert.ok(service);
          assert.deepEqual(args, [
            "compose",
            "-f",
            join(directory, "compose.json"),
            "wait",
            service,
          ]);
          assert.equal(log, `${service}-wait.log`);
          const child = await startProcess(
            process.execPath,
            [fixture, ...args],
            { logFile: join(directory, log) },
          );
          children.push(child);
          return child;
        },
      );
      for (const service of ["models", "models-database"]) {
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            ready =
              (await readFile(join(directory, `${service}.ready`), "utf8")) ===
              "ready";
          } catch (error) {
            if (!(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            ))
              throw error;
          }
          if (ready) break;
          await delay(20);
        }
        assert.equal(ready, true);
      }
      let stopped = false;
      const lifetime = Promise.race(children.map((child) => child.done)).then(
        (result) => {
          stopped = true;
          return result;
        },
      );
      await delay(25);
      assert.equal(stopped, false);
      await writeFile(join(directory, `${exited}.exit`), "exit");
      const result = await lifetime;
      assert.equal(result.kind, "exited");
      assert.equal(stopped, true);
    } finally {
      await Promise.all(children.map((child) => child.stop()));
      await rm(directory, { recursive: true, force: true });
    }
  });
}
