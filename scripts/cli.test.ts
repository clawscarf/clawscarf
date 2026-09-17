import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { initializeState } from "./local/state.js";

const execute = promisify(execFile);
const cli = (...args: string[]) =>
  execute(process.execPath, [
    "--import",
    "tsx",
    "scripts/clawscarf.ts",
    ...args,
  ]);

await test("CLI status/start use readable output or explicit JSON without issuing credentials", async (t) => {
  const root = await mkdtemp("/tmp/clawscarf-cli-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "state");
  await initializeState(directory, {
    name: "team",
    administratorName: "Administrator",
    runtimeImage: `sha256:${"a".repeat(64)}`,
    companionImage: `sha256:${"b".repeat(64)}`,
    openshellCli: "/tools/openshell",
    openshellGateway: "/tools/gateway",
    ports: {
      controller: 17671,
      application: 19000,
      widgets: 19002,
      management: 19001,
      native: 19789,
      nativeWidgets: 19790,
      database: 15432,
    },
    cpu: "2",
    memory: "2Gi",
  });
  let ready = true;
  const server = createServer((req, res) => {
    assert.equal(req.url, "/status");
    res.end(
      JSON.stringify({
        supervisor: "running",
        ready,
        administrator: ready ? "ready" : "pending",
        packs: [],
      }),
    );
  });
  const socket = join(directory, "operator.sock");
  server.listen(socket);
  await once(server, "listening");
  await chmod(socket, 0o600);
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      ),
  );
  for (const command of process.platform === "darwin"
    ? ["status", "start"]
    : ["status"]) {
    const human = await cli(command, "--state", directory);
    assert.match(
      human.stdout,
      /Server: running\nReady: Yes\nAdministrator: ready/,
    );
    assert.doesNotMatch(human.stdout, /https?:|code|\{/);
    const json = await cli(command, "--state", directory, "--json");
    assert.deepEqual(JSON.parse(json.stdout), {
      supervisor: "running",
      ready: true,
      packs: [],
      administrator: "ready",
    });
    assert.equal(
      json.stderr,
      command === "start" ? "Starting ClawScarf\n" : "",
    );
  }
  ready = false;
  const pending = await cli("status", "--state", directory);
  assert.match(pending.stdout, /Ready: No/);
  assert.match(pending.stdout, /administrator --issue/);
});

await test("CLI JSON covers nested commands and errors; file outputs remain JSON", async (t) => {
  const root = await mkdtemp("/tmp/clawscarf-cli-");
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const json of [false, true]) {
    const output = join(root, json ? "machine.json" : "human.json");
    const result = await cli(
      "models",
      "render",
      "--config",
      "deploy/models/config.example.json",
      "--output",
      output,
      ...(json ? ["--json"] : []),
    );
    if (json)
      assert.deepEqual(JSON.parse(result.stdout), {
        state: "created",
        file: output,
      });
    else assert.equal(result.stdout, "Gateway configuration written.\n");
    assert.ok(JSON.parse(await readFile(output, "utf8")));
    await assert.rejects(
      cli("validate", ...(json ? ["--json"] : [])),
      (error: unknown) => {
        assert.ok(
          error instanceof Error &&
            "stderr" in error &&
            typeof error.stderr === "string",
        );
        if (json)
          assert.partialDeepStrictEqual(JSON.parse(error.stderr), {
            code: "invalid_arguments",
          });
        else assert.match(error.stderr, /^Error: .*--config/);
        return true;
      },
    );
  }
});
