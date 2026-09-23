import { setTimeout } from "node:timers/promises";
import assert from "node:assert/strict";
import { ownerAuthorization } from "../../services/cloud/management/owner.js";
const [url, accountId] = process.argv.slice(2);
assert.ok(url);
assert.ok(accountId);
const target = {
  id: "d8267b8c-7c75-463c-8806-f36f0ff6be22",
  accountId,
  url,
  managementKeyFile: "unused",
  ai: true,
  connections: false,
};
const owner = ownerAuthorization();
try {
  assert.throws(() => owner.token("unrelated"), /Cloud account owner/);
  const pending = await owner.start("first", target);
  assert.equal(pending.state, "pending");
  assert.equal(pending.code, "TEST-CODE");
  assert.equal(new URL(pending.url ?? "").origin, url);
  assert.deepEqual(await owner.start("first", target), pending);
  await setTimeout(1100);
  assert.equal((await owner.poll("first", target)).state, "pending");
  await setTimeout(1100);
  await assert.rejects(owner.poll("first", target), /account that owns/);
  assert.equal(owner.state("first").state, "disconnected");
  await owner.start("second", target);
  await setTimeout(1100);
  assert.equal((await owner.poll("second", target)).state, "authorized");
  assert.equal(owner.token("second"), "matching-owner");
  assert.throws(() => owner.token("first"), /Cloud account owner/);
  owner.forget("second");
  assert.throws(() => owner.token("second"), /Cloud account owner/);
} finally {
  owner.close();
}
