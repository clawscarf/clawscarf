import assert from "node:assert/strict";
import { test } from "node:test";
import { run, LocalSetupError } from "../../scripts/deployment/process.js";

await test("command failures retain safe exit, signal, timeout and spawn diagnostics without subprocess payloads", async () => {
  const secret = "private-command-payload";
  const cases = [
    {
      executable: process.execPath,
      args: [
        "-e",
        `process.stdout.write('${secret}');process.stderr.write('${secret}');process.exit(7)`,
      ],
      expected: { reason: "exit", exitCode: 7 },
    },
    {
      executable: process.execPath,
      args: ["-e", "process.kill(process.pid, 'SIGTERM')"],
      expected: { reason: "signal", signal: "SIGTERM" },
    },
    {
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeout: 30,
      expected: { reason: "timeout" },
    },
    {
      executable: `/missing/${secret}/\nforged-command`,
      args: [],
      expected: { reason: "spawn", systemCode: "ENOENT" },
    },
    {
      executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(5 * 1024 * 1024))"],
      expected: { reason: "output_limit" },
    },
  ];
  for (const scenario of cases)
    await assert.rejects(
      run(
        scenario.executable,
        scenario.args,
        scenario.timeout === undefined ? {} : { timeout: scenario.timeout },
      ),
      (error: unknown) => {
        assert.ok(error instanceof LocalSetupError);
        assert.equal(error.code, "command_failed");
        assert.deepEqual(error.commandFailure, scenario.expected);
        assert.ok(!JSON.stringify(error).includes(secret));
        assert.ok(!error.message.includes(secret));
        assert.ok(!error.message.includes("\n"));
        assert.ok(!("cause" in error));
        return true;
      },
    );
  assert.equal(
    await run(process.execPath, ["-e", "process.stdout.write('ok')"]),
    "ok",
  );
});
