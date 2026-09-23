import { oidcTeam } from "./oidc.js";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserRelayConfiguration,
  prepareRelay,
  verifyRelayConfiguration,
} from "../../scripts/deployment/relay.js";
import { parseLocalInput } from "../../scripts/deployment/configuration.js";
import type { LocalState } from "../../scripts/deployment/state.js";
import { LocalSetupError } from "../../scripts/deployment/process.js";

function state(browser = true): LocalState {
  return {
    schemaVersion: 1,
    ownerId: "00000000-0000-4000-8000-000000000001",
    input: parseLocalInput({
      name: "relay-test",
      agentName: "ClawScarf",
      administratorName: "Ada",
      runtimeImage: `sha256:${"a".repeat(64)}`,
      companionImage: `sha256:${"b".repeat(64)}`,
      openshellCli: "/tools/openshell",
      openshellGateway: "/tools/gateway",
      openshellClientImage: `sha256:${"a".repeat(64)}`,
      cpu: "1",
      memory: "2Gi",
      team: oidcTeam(17212, 17213),
      ports: {
        controller: 17211,
        application: 17212,
        widgets: 17213,
        management: 17214,
        native: 17215,
        nativeWidgets: 17216,
        database: 17217,
      },
      ...(browser ? { relayImage: `sha256:${"c".repeat(64)}` } : {}),
      ...(browser
        ? {
            browser: {
              image: `sha256:${"e".repeat(64)}`,
              egressImage: `sha256:${"f".repeat(64)}`,
              nodeImage: `sha256:${"a".repeat(64)}`,
              dnsImage: `sha256:${"b".repeat(64)}`,
              port: 17219,
            },
          }
        : {}),
    }),
  };
}
function changed(error: unknown) {
  return (
    error instanceof LocalSetupError && error.code === "configuration_changed"
  );
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-relay-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "private"), { mode: 0o700 });
  const installation = state();
  return { directory, installation };
}

await test("relay defines only a fixed browser destination", () => {
  assert.deepEqual(
    [...browserRelayConfiguration.matchAll(/^ {2}bind (.+)$/gm)].map(
      (match) => match[1],
    ),
    [":9223"],
  );
  assert.deepEqual(
    [...browserRelayConfiguration.matchAll(/^ {2}server (.+)$/gm)].map(
      (match) => match[1],
    ),
    ["browser browser:9223 resolvers docker init-addr libc,none"],
  );
  assert.doesNotMatch(
    browserRelayConfiguration,
    /mode http|http-request|http-response|socks|forwardfor|host\.docker\.internal/i,
  );
});

await test("relay preparation is optional and retains its immutable fixed configuration", async (t) => {
  const f = await fixture(t);
  await prepareRelay("/does-not-exist", state(false));
  await verifyRelayConfiguration("/does-not-exist", state(false));
  const previous = process.umask(0o077);
  try {
    await prepareRelay(f.directory, f.installation);
    const path = join(f.directory, "private/browser-relay.cfg");
    assert.equal((await lstat(path)).mode & 0o777, 0o444);
    assert.equal(await readFile(path, "utf8"), browserRelayConfiguration);
    await verifyRelayConfiguration(f.directory, f.installation);
    await prepareRelay(f.directory, f.installation);
    assert.equal(await readFile(path, "utf8"), browserRelayConfiguration);
  } finally {
    process.umask(previous);
  }
});

await test("relay restart refuses a substituted destination or substituted configuration without repair", async (t) => {
  const f = await fixture(t);
  await prepareRelay(f.directory, f.installation);
  const path = join(f.directory, "private/browser-relay.cfg");
  const original = await readFile(path, "utf8");
  const broadened = original.replace(
    "server browser browser:9223",
    "server browser other:9223",
  );
  assert.notEqual(broadened, original);
  await chmod(path, 0o600);
  await writeFile(path, broadened);
  await chmod(path, 0o444);
  await assert.rejects(
    verifyRelayConfiguration(f.directory, f.installation),
    changed,
  );
  await assert.rejects(prepareRelay(f.directory, f.installation), changed);
  assert.equal(await readFile(path, "utf8"), broadened);
  await rm(path);
  const alternate = join(f.directory, "private/other-relay.cfg");
  await writeFile(alternate, original, { mode: 0o444 });
  await symlink(alternate, path);
  await assert.rejects(
    verifyRelayConfiguration(f.directory, f.installation),
    changed,
  );
});
