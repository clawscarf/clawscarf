import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
await test("operator SDK bridge validates input, pins UUID, and preserves uncertain completion without replay", async () => {
  await promisify(execFile)("python3", ["tests/packs/transport_test.py"], {
    timeout: 10000,
  });
});
