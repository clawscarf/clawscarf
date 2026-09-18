import { oidcTeam } from "./oidc.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  mkdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeState,
  readInstallationIdentity,
  readState,
  withInstallationLock,
  resourceNames,
} from "../../scripts/deployment/state.js";
import { parseLocalInput } from "../../scripts/deployment/configuration.js";
import { composeConfiguration } from "../../scripts/deployment/compose.js";
const input = parseLocalInput({
  name: "local",
  administratorName: "Admin",
  runtimeImage: "sha256:" + "a".repeat(64),
  companionImage: "sha256:" + "b".repeat(64),
  openshellCli: "/tmp/openshell",
  openshellGateway: "/tmp/gateway",
  openshellClientImage: `sha256:${"a".repeat(64)}`,
  team: oidcTeam(18800, 18802),
  ports: {
    controller: 17671,
    application: 18800,
    widgets: 18802,
    management: 18801,
    native: 18789,
    nativeWidgets: 18790,
    database: 15432,
  },
  cpu: "2",
  memory: "2Gi",
});
await test("cleanup identity survives invalid inputs but rejects missing ownership and unsafe directories", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "state");
  const state = await initializeState(directory, input);
  const identity = {
    schemaVersion: state.schemaVersion,
    ownerId: state.ownerId,
  };
  const record = join(directory, "installation.json");
  for (const invalidInput of [undefined, null, {}, { team: {} }]) {
    await writeFile(
      record,
      JSON.stringify({ ...identity, input: invalidInput }),
    );
    assert.deepEqual(await readInstallationIdentity(directory), identity);
    await assert.rejects(readState(directory));
  }
  for (const invalidIdentity of [
    {},
    { schemaVersion: 1 },
    { ownerId: state.ownerId },
    { ...identity, ownerId: "not-an-installation-id" },
    { ...identity, schemaVersion: 2 },
  ]) {
    await writeFile(record, JSON.stringify(invalidIdentity));
    await assert.rejects(readInstallationIdentity(directory));
  }
  await writeFile(record, JSON.stringify(identity));
  await chmod(directory, 0o755);
  await assert.rejects(
    readInstallationIdentity(directory),
    /private installation directory/,
  );
  await chmod(directory, 0o700);
  const link = join(root, "linked");
  await symlink(directory, link);
  await assert.rejects(
    readInstallationIdentity(link),
    /private installation directory/,
  );
});

await test("local preparation retains private identity/secrets and rejects foreign directories or changed inputs", async () => {
  const parent = await mkdtemp(join(tmpdir(), "clawscarf-setup-"));
  try {
    const directory = join(parent, "install");
    const state = await initializeState(directory, input);
    const names = resourceNames(state);
    for (const name of [names.sandbox]) {
      assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(
        name.length <= 19,
        "Pinned OpenShell routable names permit at most 19 characters.",
      );
    }
    const key = await readFile(join(directory, "private/encryption.key"));
    assert.equal(
      (await initializeState(directory, input)).ownerId,
      state.ownerId,
    );
    assert.deepEqual(
      await readFile(join(directory, "private/encryption.key")),
      key,
    );
    await assert.rejects(
      initializeState(directory, { ...input, administratorName: "Other" }),
    );
    await withInstallationLock(directory, () =>
      assert.rejects(
        withInstallationLock(directory, () => Promise.resolve(undefined)),
      ),
    );
    const other = join(parent, "foreign");
    await mkdir(other, { mode: 0o700 });
    await writeFile(join(other, "keep"), "data");
    await assert.rejects(initializeState(other, input));
    assert.equal(await readFile(join(other, "keep"), "utf8"), "data");
    const composed = composeConfiguration(state, directory);
    assert.deepEqual(composed.networks, {
      default: {
        external: true,
        name: `clawscarf-${state.ownerId.replaceAll("-", "").slice(0, 12)}_default`,
      },
    });
    const mounts = composed.services.companion.volumes;
    assert.equal(
      mounts.some((value) => value.includes("database-admin-password")),
      false,
    );
    assert.equal(
      mounts.some((value) => value.includes("controller")),
      false,
    );
    assert.equal(
      mounts.some((value) => value.includes("/connections")),
      false,
    );
    const enabled = composeConfiguration(
      {
        ...state,
        input: {
          ...state.input,
          connections: {
            mode: "external",
            brokerUrl: "https://cloud.example.com/api/connections",
            managementKeyFile: "/source/private/key",
          },
        },
      },
      directory,
    );
    assert.ok(
      enabled.services.companion.volumes.includes(
        `${join(directory, "private/connections")}:/run/clawscarf/connections:ro`,
      ),
    );
    assert.equal(JSON.stringify(enabled).includes("/source/"), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
