import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ActivationTelemetry } from "../../plugins/access/src/telemetry.js";

await test("only the first successful human response is sent, without conversation data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-activation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      bodies.push(body);
      res.end('{"status":1}');
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const environment = {
    CLAWSCARF_TELEMETRY_INSTALLATION_ID: "6d5fc3df-f248-4eea-8264-df527ec7ef24",
    CLAWSCARF_TELEMETRY_HOST: `http://127.0.0.1:${String(address.port)}`,
    CLAWSCARF_TELEMETRY_PROJECT_TOKEN: "phc_test",
    CLAWSCARF_TELEMETRY_DISABLED: "0",
  };
  const tracker = new ActivationTelemetry(() => environment, directory);
  tracker.response(
    { runId: "background", assistantTexts: ["secret response"] },
    { inputProvenance: { kind: "internal_system" } },
  );
  await tracker.finished({ runId: "background", success: true });
  tracker.response(
    { runId: "failed", assistantTexts: ["partial secret"] },
    { inputProvenance: { kind: "external_user" } },
  );
  await tracker.finished({ runId: "failed", success: false });
  await tracker.finished({ runId: "no-output", success: true });
  tracker.response(
    { runId: "silent", assistantTexts: ["NO_REPLY"] },
    { inputProvenance: { kind: "external_user" } },
  );
  await tracker.finished({ runId: "silent", success: true });
  tracker.response(
    { runId: "empty-final", assistantTexts: ["partial"] },
    { inputProvenance: { kind: "external_user" } },
  );
  tracker.response(
    { runId: "empty-final", assistantTexts: [] },
    { inputProvenance: { kind: "external_user" } },
  );
  await tracker.finished({ runId: "empty-final", success: true });
  assert.equal(bodies.length, 0);
  assert.deepEqual(await readdir(directory), []);
  environment.CLAWSCARF_TELEMETRY_DISABLED = "1";
  tracker.response(
    { runId: "disabled", assistantTexts: ["secret"] },
    { inputProvenance: { kind: "external_user" } },
  );
  await tracker.finished({ runId: "disabled", success: true });
  assert.equal(bodies.length, 0);
  environment.CLAWSCARF_TELEMETRY_DISABLED = "0";
  for (const runId of ["first", "repeat"]) {
    tracker.response(
      { runId, assistantTexts: ["secret response"] },
      { inputProvenance: { kind: "external_user" } },
    );
    await tracker.finished({ runId, success: true });
  }
  const restarted = new ActivationTelemetry(() => environment, directory);
  restarted.response(
    { runId: "after-restart", assistantTexts: ["secret"] },
    { inputProvenance: { kind: "external_user" } },
  );
  await restarted.finished({ runId: "after-restart", success: true });
  assert.equal(bodies.length, 1);
  assert.match(bodies[0] ?? "", /first_agent_response/);
  assert.match(
    bodies[0] ?? "",
    /installation:6d5fc3df-f248-4eea-8264-df527ec7ef24/,
  );
  assert.doesNotMatch(
    bodies[0] ?? "",
    /secret|runId|assistantTexts|inputProvenance|external_user/,
  );
});
