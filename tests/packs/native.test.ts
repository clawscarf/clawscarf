import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gatewayPassword } from "../../runtime/gateway-password.js";
import { NativeClaws } from "../../scripts/packs/native.js";
import {
  inspectPack,
  planPack,
  applyPack,
} from "../../scripts/packs/lifecycle.js";
import { z } from "zod";
import WebSocket from "ws";
import { packSchema } from "../../scripts/packs/model.js";

await test(
  "trusted-proxy pack removal cleans owned automation and preserves edited files",
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
    const previousPassword = process.env.OPENCLAW_GATEWAY_PASSWORD;
    const previousToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
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
      await mkdir(join(directory, "state"), { recursive: true, mode: 0o700 });
      process.env.OPENCLAW_GATEWAY_PASSWORD = await gatewayPassword(
        join(directory, "state"),
        true,
      );
      await writeFile(
        join(directory, "state/openclaw.json"),
        JSON.stringify({
          gateway: {
            mode: "local",
            bind: "loopback",
            port,
            trustedProxies: ["127.0.0.1"],
            auth: {
              mode: "trusted-proxy",
              trustedProxy: {
                userHeader: "x-openclaw-user",
                requiredHeaders: ["x-forwarded-proto", "x-forwarded-host"],
                allowLoopback: true,
              },
            },
          },
          agents: {
            defaults: { workspace: join(directory, "default-workspace") },
          },
        }),
      );
      const executable = resolve(
        process.env.CLAWSCARF_TEST_OPENCLAW ??
          "plugins/connections/node_modules/.bin/openclaw",
      );
      const password = process.env.OPENCLAW_GATEWAY_PASSWORD;
      assert.ok(password);
      if (process.env.CLAWSCARF_TEST_OPENCLAW)
        delete process.env.OPENCLAW_GATEWAY_PASSWORD;
      const startGateway = async () => {
        gateway = spawn(
          executable,
          ["gateway", "run", "--allow-unconfigured"],
          {
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let startup = "";
        gateway.stdout?.on("data", (data: Buffer) => {
          startup = (startup + data.toString()).slice(-4000);
        });
        gateway.stderr?.on("data", (data: Buffer) => {
          startup = (startup + data.toString()).slice(-4000);
        });
        let ready = false;
        for (let attempt = 0; attempt < 300; attempt++) {
          try {
            ready = (await fetch(`http://127.0.0.1:${port}/readyz`)).ok;
          } catch {
            ready = false;
          }
          if (ready) break;
          await delay(100);
        }
        assert.ok(ready, "Native Gateway startup: " + startup);
      };
      await startGateway();
      // A known local password must not authenticate forwarded/proxy-shaped traffic.
      const reply = Promise.withResolvers<unknown>();
      const client = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: {
          "x-forwarded-for": "203.0.113.10",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "team.example",
        },
      });
      const timeout = setTimeout(
        () => reply.reject(Error("Native auth response timed out")),
        10000,
      );
      client.on("error", reply.reject);
      client.on("message", (data) => {
        if (!Buffer.isBuffer(data)) {
          reply.reject(Error("Unexpected native frame"));
          return;
        }
        const message = z
          .object({
            type: z.string(),
            event: z.string().optional(),
            id: z.string().optional(),
          })
          .passthrough()
          .parse(JSON.parse(data.toString()));
        if (message.event === "connect.challenge")
          client.send(
            JSON.stringify({
              type: "req",
              id: "auth-check",
              method: "connect",
              params: {
                minProtocol: 4,
                maxProtocol: 4,
                client: {
                  id: "gateway-client",
                  version: "test",
                  platform: process.platform,
                  mode: "backend",
                },
                role: "operator",
                scopes: ["operator.admin"],
                auth: { password },
              },
            }),
          );
        if (message.type === "res" && message.id === "auth-check")
          reply.resolve(message);
      });
      try {
        const rejected = await reply.promise;
        const denied = z
          .object({
            ok: z.literal(false),
            error: z.object({
              details: z.object({
                code: z.literal("AUTH_UNAUTHORIZED"),
                authReason: z.literal("trusted_proxy_user_missing"),
              }),
            }),
          })
          .safeParse(rejected);
        assert.ok(denied.success, JSON.stringify(rejected));
      } finally {
        clearTimeout(timeout);
        client.terminate();
      }
      const jobs = async (native: NativeClaws) =>
        z
          .object({
            jobs: z.array(z.object({ agentId: z.string().optional() })),
          })
          .parse(await native.run(["cron", "list", "--all", "--json"])).jobs;
      await cp(resolve("packs/research-team"), source, { recursive: true });
      const manifest = packSchema.parse(
        JSON.parse(await readFile(join(source, "pack.json"), "utf8")),
      );
      // This fixture tests lifecycle without buying model inference; production pack
      // still requires configured-default and is separately checked by its preflight.
      for (const member of manifest.members) member.requirements.model = "none";
      await writeFile(join(source, "pack.json"), JSON.stringify(manifest));
      const native = new NativeClaws(executable);
      assert.equal((await inspectPack(source, native)).members.length, 2);
      const automated = manifest.members[0];
      assert.ok(automated);
      const claw = join(source, automated.source, "CLAW.md");
      await writeFile(
        claw,
        (await readFile(claw, "utf8")).replace(
          "cronJobs: []",
          'cronJobs: [{id: annual-review, schedule: {cron: "0 0 1 1 *", timezone: UTC}, session: isolated, message: "Review documents", delivery: {mode: none}}]',
        ),
      );
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
        if (member.id === automated.id) {
          assert.ok(
            (await jobs(native)).some((job) => job.agentId === member.id),
          );
          assert.ok(gateway);
          gateway.kill("SIGTERM");
          await once(gateway, "exit");
          assert.equal(
            await gatewayPassword(join(directory, "state"), false),
            password,
          );
          await startGateway();
        }
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
          (await jobs(native)).some((job) => job.agentId === member.id),
          false,
        );
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
        ["OPENCLAW_GATEWAY_TOKEN", previousToken],
        ["OPENCLAW_GATEWAY_PASSWORD", previousPassword],
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
