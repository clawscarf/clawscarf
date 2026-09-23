import { oidcTeam } from "../tests/deployment/oidc.js";
import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { initializeState } from "./deployment/state.js";

// Test CLI invocations never report to the packaged production destination.
process.env.CLAWSCARF_TELEMETRY_DISABLED = "1";

const execute = promisify(execFile);
let commandEnvironment: NodeJS.ProcessEnv | undefined;
const cli = (...args: string[]) =>
  execute(process.execPath, ["scripts/clawscarf.mjs", ...args], {
    env: commandEnvironment,
  });

await test("linked development command resolves its checkout", async (t) => {
  const directory = await mkdtemp("/tmp/clawscarf-linked-cli-");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const launcher = join(directory, "clawscarf");
  await symlink(resolve("scripts/clawscarf.mjs"), launcher);
  const { stdout } = await execute(process.execPath, [launcher, "--help"], {
    cwd: directory,
  });
  assert.match(stdout, /Usage: clawscarf/);
});

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
    agentName: "ClawScarf",
    administratorName: "Administrator",
    publicWeb: false,
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
  const human = await cli("status", "--directory", root);
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
  await writeFile(fixture, JSON.stringify({ running: true, complete: false }));
  const pending = await cli("status", "--directory", root);
  assert.match(pending.stdout, /Ready: No/);
  assert.match(pending.stdout, /administrator --issue/);
});

await test("CLI missing-installation errors support human and JSON output", async (t) => {
  const root = await mkdtemp("/tmp/clawscarf-empty-cli-");
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const json of [false, true]) {
    await assert.rejects(
      cli("status", "--directory", root, ...(json ? ["--json"] : [])),
      (error: unknown) => {
        assert.ok(
          error instanceof Error &&
            "stderr" in error &&
            typeof error.stderr === "string",
        );
        if (json)
          assert.partialDeepStrictEqual(JSON.parse(error.stderr), {
            code: "unavailable",
          });
        else
          assert.match(
            error.stderr,
            /^Error: No installation found.*clawscarf configure.*--directory/,
          );
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
      cli("stop", "--directory", "/tmp/not-an-installation", "--json", ...args),
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

await test("configuration flags preserve explicit disablement", async () => {
  const { installationCommand } = await import("./installation/command.js");
  const command = installationCommand().commands.find(
    (item) => item.name() === "configure",
  );
  assert.ok(command);
  command.action(() => {});
  await command.parseAsync([
    "node",
    "configure",
    "--directory",
    "/tmp/team",
    "--no-connections",
    "--no-start",
  ]);
  assert.equal(command.opts().connections, false);
  assert.equal(command.opts().start, false);
  assert.equal(command.opts().browser, undefined);
  const { selectionSchema } = await import("./installation/options.js");
  assert.equal(selectionSchema.parse(command.opts()).packs, undefined);
});

await test("file and JSON failures identify the input without disclosing its contents", async (t) => {
  const directory = await mkdtemp("/tmp/cs-cli-errors-");
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const value of [undefined, '{"secret":"sk-do-not-print"']) {
    if (value) await writeFile(join(directory, "installation.json"), value);
    await assert.rejects(
      cli("status", "--directory", directory, "--json"),
      (error: unknown) => {
        assert.ok(
          error instanceof Error &&
            "stderr" in error &&
            typeof error.stderr === "string",
        );
        const result: unknown = JSON.parse(error.stderr);
        assert.partialDeepStrictEqual(result, {
          code: value ? "invalid_configuration" : "unavailable",
        });
        assert.match(
          error.stderr,
          value ? /installation.json/ : /No installation found/,
        );
        assert.doesNotMatch(error.stderr, /sk-do-not-print/);
        return true;
      },
    );
  }
});
