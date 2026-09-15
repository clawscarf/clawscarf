import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForStartGate } from "../../runtime/start-gate.js";

await test("replacement stays gated until its own generation is released", async () => {
  const id = "6b460dcb-dc3e-4f75-a8c3-4c663adf0455";
  let reads = 0;
  let waits = 0;
  await waitForStartGate(
    id,
    () => {
      reads++;
      if (reads === 1)
        return Promise.reject(Object.assign(Error(), { code: "ENOENT" }));
      return Promise.resolve(reads === 2 ? "another-generation" : id + "\n");
    },
    () => {
      waits++;
      return Promise.resolve();
    },
  );
  assert.equal(reads, 3);
  assert.equal(waits, 2);
});

await test("invalid gate and unreadable marker fail closed", async () => {
  await assert.rejects(
    waitForStartGate("../bad"),
    /Invalid runtime startup gate/,
  );
  await assert.rejects(
    waitForStartGate("6b460dcb-dc3e-4f75-a8c3-4c663adf0455", () => {
      return Promise.reject(
        Object.assign(Error("unreadable"), { code: "EACCES" }),
      );
    }),
    /unreadable/,
  );
});
