import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeState,
  withLocalLock,
  resourceNames,
} from "../../scripts/local/state.js";
import { parseLocalInput } from "../../scripts/local/configuration.js";
import { composeConfiguration } from "../../scripts/local/compose.js";
const input = parseLocalInput({
  name: "local",
  administratorName: "Admin",
  runtimeImage: "sha256:" + "a".repeat(64),
  companionImage: "sha256:" + "b".repeat(64),
  openshellCli: "/tmp/openshell",
  openshellGateway: "/tmp/gateway",
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
await test("local preparation retains private identity/secrets and rejects foreign directories or changed inputs", async () => {
  const parent = await mkdtemp(join(tmpdir(), "clawscarf-setup-"));
  try {
    const directory = join(parent, "install");
    const state = await initializeState(directory, input);
    const names = resourceNames(state);
    assert.notEqual(names.sandbox, names.workerSandbox);
    for (const name of [names.sandbox, names.workerSandbox]) {
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
    await withLocalLock(directory, () =>
      assert.rejects(
        withLocalLock(directory, () => Promise.resolve(undefined)),
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
            mode: "local",
            projectId: "project",
            apiKeyFile: "/source/private/key",
            catalogDirectory: "/source/catalog",
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
