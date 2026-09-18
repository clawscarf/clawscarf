import { oidcTeam } from "../tests/deployment/oidc.js";
import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { initializeState } from "./deployment/state.js";

const execute = promisify(execFile);
let commandEnvironment: NodeJS.ProcessEnv | undefined;
const cli = (...args: string[]) =>
  execute(
    process.execPath,
    ["--import", "tsx", "scripts/clawscarf.ts", ...args],
    { env: commandEnvironment },
  );

await test("CLI status use readable output or explicit JSON without issuing credentials", async (t) => {
  const root = await mkdtemp("/tmp/clawscarf-cli-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "private-runtime");
  await writeFile(
    join(root, "installation.json"),
    JSON.stringify({ stateDirectory: "./private-runtime", name: "team" }),
  );
  const native = createServer((_req, res) => {
    res.end("ok");
  });
  native.listen(0, "127.0.0.1");
  await once(native, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        native.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      ),
  );
  const address = native.address();
  assert.ok(address && typeof address !== "string");
  await initializeState(directory, {
    name: "team",
    administratorName: "Administrator",
    runtimeImage: `sha256:${"a".repeat(64)}`,
    companionImage: `sha256:${"b".repeat(64)}`,
    openshellCli: "/tools/openshell",
    openshellGateway: "/tools/gateway",
    openshellClientImage: `sha256:${"a".repeat(64)}`,
    team: oidcTeam(19000, 19002),
    ports: {
      controller: 17671,
      application: 19000,
      widgets: 19002,
      management: 19001,
      native: address.port,
      nativeWidgets: 19790,
      database: 15432,
    },
    cpu: "2",
    memory: "2Gi",
  });
  const fixture = join(root, "observed.json");
  await writeFile(fixture, JSON.stringify({ running: true, complete: true }));
  await writeFile(
    join(root, "docker"),
    `#!${process.execPath}
const fs = require("node:fs");
const fixture = JSON.parse(fs.readFileSync(${JSON.stringify(fixture)}, "utf8"));
const args = process.argv.slice(2);
if(args.includes("ps")) console.log(JSON.stringify({Service:"companion", State: fixture.running ? "running" : "exited"}));
else if(args.includes("--services")) console.log("companion");
else if(args.includes("ls")) for(let i=0;i<1;i++) console.log(JSON.stringify({State: fixture.running ? "running" : "exited"}));
else if(args.includes("exec")) console.log(JSON.stringify({complete:fixture.complete,expiresAt:null}));
else process.exit(1);
`,
    { mode: 0o700 },
  );
  commandEnvironment = {
    ...process.env,
    PATH: root + ":" + (process.env.PATH ?? ""),
  };
  t.after(() => {
    commandEnvironment = undefined;
  });
  const human = await cli("status", "--state", directory);
  assert.match(
    human.stdout,
    /Server: running\nReady: Yes\nAdministrator: ready/,
  );
  assert.doesNotMatch(human.stdout, /https?:|code|\{/);
  const json = await cli("status", "--directory", root, "--json");
  assert.partialDeepStrictEqual(JSON.parse(json.stdout), {
    state: "running",
    ready: true,
    administrator: "ready",
    packs: [],
  });
  assert.equal(json.stderr, "");
  for (const command of [
    ["start"],
    ["status"],
    ["stop"],
    ["administrator"],
    ["settings"],
    ["logs", "--service", "controller"],
    ["upgrade", "--runtime-image", "unused", "--python", "unused", "--yes"],
    ["connections", "observe"],
    ["connections", "configure", "--credential-file", "unused", "--yes"],
  ]) {
    await assert.rejects(
      cli(...command, "--directory", root, "--state", directory, "--json"),
      (error: unknown) => {
        assert.ok(
          error instanceof Error &&
            "stderr" in error &&
            typeof error.stderr === "string",
        );
        assert.partialDeepStrictEqual(JSON.parse(error.stderr), {
          code: "invalid_configuration",
        });
        assert.match(error.stderr, /Supply either/);
        return true;
      },
    );
  }
  const candidate = join(root, "invalid.json");
  await writeFile(candidate, "{}");
  await assert.rejects(
    cli("settings", "plan", "--config", candidate, "--json"),
    (error: unknown) => {
      assert.ok(
        error instanceof Error &&
          "stderr" in error &&
          typeof error.stderr === "string",
      );
      assert.match(error.stderr, /Invalid or missing fields/);
      assert.doesNotMatch(error.stderr, /Supply either/);
      return true;
    },
  );
  await writeFile(fixture, JSON.stringify({ running: true, complete: false }));
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

await test("CLI deletion refuses missing confirmations without touching an installation", async () => {
  for (const args of [
    ["--delete"],
    ["--delete", "--confirm-delete", "/tmp/not-an-installation"],
    ["--accept-data-loss"],
  ]) {
    await assert.rejects(
      cli("stop", "--state", "/tmp/not-an-installation", "--json", ...args),
      (error: unknown) => {
        assert.ok(
          error instanceof Error &&
            "stderr" in error &&
            typeof error.stderr === "string",
        );
        assert.match(error.stderr, /invalid_configuration/);
        assert.match(error.stderr, /confirmations|requires|require/);
        return true;
      },
    );
  }
});
