import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import console from "node:console";
const root = "/home/node";
const realModel = process.env.CLAWSCARF_TEST_REAL_MODEL === "1";
const environment = { ...process.env };
delete environment.CLAWSCARF_MODEL_TOKEN;
delete environment.NODE_EXTRA_CA_CERTS;
const result = spawnSync(
  "/app/clawscarf/bin/openclaw",
  [
    "agent",
    "exec",
    "Read /home/node/model-proof.txt with the read tool, then report.",
    "--cwd",
    root,
    "--model",
    "clawscarf/team-model",
    "--code-mode",
    "direct",
    "--json",
    "--timeout",
    realModel ? "180" : "30",
  ],
  {
    encoding: "utf8",
    timeout: realModel ? 200000 : 40000,
    env: environment,
  },
);
assert.equal(result.status, 0, "Native model execution must complete.");
const body = JSON.parse(result.stdout);
assert.equal(body.ok, true);
assert.equal(body.provider, "clawscarf");
assert.equal(body.model, "team-model");
assert.ok(body.toolSummary.calls >= 1);
assert.equal(typeof body.final, "string");
assert.ok(body.final.trim());
assert.equal(body.toolSummary.failures, 0);
assert.deepEqual(body.toolSummary.tools, ["read"]);
console.log(
  "OpenClaw model stream and native read tool passed through the configured gateway.",
);
