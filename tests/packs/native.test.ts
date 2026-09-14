import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NativeClaws } from "../../scripts/packs/native.js";
import {
  inspectPack,
  planPack,
  applyPack,
} from "../../scripts/packs/lifecycle.js";
import { packSchema } from "../../scripts/packs/model.js";

await test(
  "two native Claws install/update/remove with exact consent and preserve edited user files",
  { skip: process.env.CLAWSCARF_TEST_NATIVE_PACKS !== "1", timeout: 180000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-packs-"));
    const source = join(directory, "pack");
    const previous = {
      state: process.env.OPENCLAW_STATE_DIR,
      config: process.env.OPENCLAW_CONFIG_PATH,
      experimental: process.env.OPENCLAW_EXPERIMENTAL_CLAWS,
    };
    process.env.OPENCLAW_STATE_DIR = join(directory, "state");
    process.env.OPENCLAW_CONFIG_PATH = join(directory, "state/openclaw.json");
    process.env.OPENCLAW_EXPERIMENTAL_CLAWS = "1";
    let gateway: ReturnType<typeof spawn> | undefined;
    try {
      const reserve = createServer();
      reserve.listen(0, "127.0.0.1");
      await once(reserve, "listening");
      const address = reserve.address();
      assert.ok(address && typeof address !== "string");
      const port = address.port;
      await new Promise<void>((resolve, reject) =>
        reserve.close((error) => (error ? reject(error) : resolve())),
      );
      await mkdir(join(directory, "state"), { recursive: true });
      await writeFile(
        join(directory, "state/openclaw.json"),
        JSON.stringify({
          gateway: {
            mode: "local",
            port,
            auth: { mode: "token", token: "clawscarf-native-pack-test-token" },
          },
          agents: {
            defaults: { workspace: join(directory, "default-workspace") },
          },
        }),
      );
      const executable = resolve(
        "plugins/connections/node_modules/.bin/openclaw",
      );
      gateway = spawn(executable, ["gateway", "run", "--allow-unconfigured"], {
        env: process.env,
        stdio: "ignore",
      });
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok;
        } catch {
          ready = false;
        }
        if (ready) break;
        await delay(100);
      }
      assert.ok(ready, "Native Gateway startup");
      await cp(resolve("packs/research-team"), source, { recursive: true });
      const manifest = packSchema.parse(
        JSON.parse(await readFile(join(source, "pack.json"), "utf8")),
      );
      // This fixture tests lifecycle without buying model inference; production pack
      // still requires configured-default and is separately checked by its preflight.
      for (const member of manifest.members) member.requirements.model = "none";
      await writeFile(join(source, "pack.json"), JSON.stringify(manifest));
      const native = new NativeClaws(
        resolve("plugins/connections/node_modules/.bin/openclaw"),
      );
      assert.equal((await inspectPack(source, native)).members.length, 2);
      for (const member of manifest.members) {
        const input = {
          directory: source,
          member: member.id,
          workspace: join(directory, member.id),
          operation: "add" as const,
        };
        const plan = await planPack(input, native);
        await applyPack(plan, native);
        assert.match(
          await readFile(join(input.workspace, "SOUL.md"), "utf8"),
          new RegExp(member.id, "i"),
        );
        await assert.rejects(applyPack(plan, native));
        await writeFile(
          join(input.workspace, "notes.txt"),
          "keep this human note",
        );
        const update = await planPack(
          { ...input, operation: "update" },
          native,
        );
        await applyPack(update, native);
        await writeFile(
          join(input.workspace, "SOUL.md"),
          "Human-edited identity",
        );
        const removal = await planPack(
          { ...input, operation: "remove" },
          native,
        );
        await applyPack(removal, native);
        assert.equal(
          await readFile(join(input.workspace, "notes.txt"), "utf8"),
          "keep this human note",
        );
        assert.equal(
          await readFile(join(input.workspace, "SOUL.md"), "utf8"),
          "Human-edited identity",
        );
      }
    } finally {
      if (gateway && gateway.exitCode === null) {
        gateway.kill("SIGTERM");
        await once(gateway, "exit");
      }
      for (const [name, value] of [
        ["OPENCLAW_STATE_DIR", previous.state],
        ["OPENCLAW_CONFIG_PATH", previous.config],
        ["OPENCLAW_EXPERIMENTAL_CLAWS", previous.experimental],
      ]) {
        if (name) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
