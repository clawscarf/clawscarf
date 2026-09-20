import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gatewayPassword } from "../../runtime/gateway-password.js";

await test("local Gateway credential survives restart and CLI never creates it", async (t) => {
  const state = await mkdtemp(join(tmpdir(), "clawscarf-gateway-password-"));
  t.after(() => rm(state, { recursive: true, force: true }));
  assert.equal(await gatewayPassword(state, false), undefined);
  const first = await gatewayPassword(state, true);
  assert.match(first ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await gatewayPassword(state, false), first);
  assert.equal(await gatewayPassword(state, true), first);
  const path = join(state, "clawscarf-gateway-password");
  await chmod(path, 0o644);
  await assert.rejects(gatewayPassword(state, true));
  assert.equal(await readFile(path, "utf8"), first);
  await chmod(path, 0o600);
  await writeFile(path, "corrupted");
  await assert.rejects(gatewayPassword(state, true));
  assert.equal(await readFile(path, "utf8"), "corrupted");
  await rm(path);
  const other = join(state, "other");
  await writeFile(other, first ?? "", { mode: 0o600 });
  await symlink(other, path);
  await assert.rejects(gatewayPassword(state, true));
});
