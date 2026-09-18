import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { OpenShellClaws } from "../../scripts/packs/openshell.js";
import { NativeClaws } from "../../scripts/packs/native.js";

const gatewayId = "00000000-0000-4000-8000-000000000001";
const requirement = {
  binary: "/usr/local/bin/node",
  host: "api.example.com",
  port: 443,
  protocol: "tcp" as const,
};

// Exercise actual child-process request serialization; no controller or sandbox is started.
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-pack-target-"));
  const executable = join(directory, "operator");
  const stateFile = join(directory, "state.json");
  const log = join(directory, "calls.jsonl");
  const state = { gatewayId, runtimeHasBinary: true, permitted: true };
  await writeFile(stateFile, JSON.stringify(state));
  await writeFile(log, "");
  await writeFile(
    executable,
    `#!${process.execPath}
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.env.TARGET_STATE, 'utf8'));
const args = process.argv.slice(2);
const log = value => fs.appendFileSync(process.env.TARGET_LOG, JSON.stringify(value)+'\\n');
if(args[0].endsWith('.py')) {
 const request = JSON.parse(fs.readFileSync(0, 'utf8'));
 log({kind:'exec', sandboxId:request.sandboxId, command:request.command});
 if(request.command[0] === '/app/clawscarf/bin/openclaw') process.stdout.write('{}');
 else if(request.sandboxId !== state.gatewayId || !state.runtimeHasBinary) process.exit(1);
} else {
 log({kind:'cli', args});
 const name = args[2];
 if(args[0] === 'sandbox') process.stdout.write(JSON.stringify({
  id:state.gatewayId,
  name, phase:'Ready',current_policy_version:1
 }));
 else if(args.includes('--rev')) process.stdout.write(JSON.stringify({
  sandbox:name, version:1,active_version:1,hash:'a'.repeat(64),status:'loaded',loaded_at_ms:1
 }));
 else process.stdout.write(JSON.stringify({
  sandbox:name, version:1,hash:'a'.repeat(64),config_revision:1,status:'effective',policy_source:'sandbox',
  policy:{network_policies:state.permitted ? {api:{binaries:[{path:'/usr/local/bin/node'}],endpoints:[{host:'api.example.com',port:443,protocol:'tcp'}]}} : {}}
 }));
}
`,
    { mode: 0o700 },
  );
  const options = {
    executable,
    python: executable,
    sandbox: "gateway",
    gateway: "controller",
    env: { ...process.env, TARGET_STATE: stateFile, TARGET_LOG: log },
  };
  return {
    native: new OpenShellClaws(options),
    options,
    state,
    save: () => writeFile(stateFile, JSON.stringify(state)),
    calls: async () =>
      z
        .array(
          z.object({
            kind: z.string(),
            sandboxId: z.string().optional(),
            command: z.array(z.string()).optional(),
            args: z.array(z.string()).optional(),
          }),
        )
        .parse(
          (await readFile(log, "utf8"))
            .trim()
            .split("\n")
            .map((line): unknown => JSON.parse(line)),
        ),
    close: () => rm(directory, { recursive: true, force: true }),
  };
}
await test("pack native calls, binaries and policy use the same protected runtime", async () => {
  const f = await fixture();
  try {
    await f.native.run(["agents", "list", "--json"]);
    await f.native.binary("node");
    const proof = await f.native.network([requirement]);
    assert.equal(proof?.sandboxId, gatewayId);
    const calls = await f.calls();
    const executions = calls.filter((call) => call.kind === "exec");
    assert.deepEqual(
      executions.map((call) => call.sandboxId),
      [gatewayId, gatewayId, gatewayId],
    );
    assert.ok(
      calls
        .filter((call) => call.args?.[0] === "policy")
        .every((call) => call.args?.[2] === "gateway"),
    );
    f.state.runtimeHasBinary = false;
    await f.save();
    await assert.rejects(f.native.binary("node"));
    f.state.runtimeHasBinary = true;
    f.state.permitted = false;
    await f.save();
    await assert.rejects(
      f.native.network([requirement]),
      /No exact loaded TCP grant/,
    );
  } finally {
    await f.close();
  }
});
await test("pack targets pin the runtime identity and reject replacement", async () => {
  const f = await fixture();
  try {
    const first = await f.native.target();
    assert.equal(first.kind, "openshell");
    if (first.kind !== "openshell") throw Error("Expected protected target");
    assert.equal(first.sandboxId, gatewayId);
    f.state.gatewayId = "00000000-0000-4000-8000-000000000003";
    await f.save();
    await assert.rejects(f.native.target(), /identity changed/);
  } finally {
    await f.close();
  }
});
await test("local pack operators cannot substitute local binaries for protected runtime proof", async () => {
  await assert.rejects(
    new NativeClaws("unused").binary("node"),
    /operator-side verification/,
  );
});
