import { oidcTeam } from "./oidc.js";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { upgradeLocal } from "../../scripts/deployment/upgrade.js";
import {
  requireNoUpgrade,
  readUpgrade,
} from "../../scripts/deployment/upgrade-state.js";
import {
  readState,
  writePrivate,
  resourceNames,
  type LocalState,
} from "../../scripts/deployment/state.js";
import { type run } from "../../scripts/deployment/process.js";

const oldId = "00000000-0000-4000-8000-000000000002";
const newId = "00000000-0000-4000-8000-000000000003";
const newImage = `sha256:${"b".repeat(64)}`;
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-upgrade-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "private"));
  const state: LocalState = {
    schemaVersion: 1,
    ownerId: "00000000-0000-4000-8000-000000000001",
    input: {
      name: "test",
      administratorName: "Ada",
      runtimeImage: `sha256:${"a".repeat(64)}`,
      companionImage: `sha256:${"c".repeat(64)}`,
      openshellCli: process.execPath,
      openshellGateway: process.execPath,
      openshellClientImage: `sha256:${"a".repeat(64)}`,
      cpu: "2",
      memory: "2Gi",
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
    },
  };
  await writePrivate(
    join(directory, "installation.json"),
    JSON.stringify(state),
  );
  const names = resourceNames(state);
  const receipt = {
    ownerId: state.ownerId,
    name: names.sandbox,
    image: state.input.runtimeImage,
  };
  await writePrivate(
    join(directory, "runtime-create.json"),
    JSON.stringify(receipt),
  );
  await writePrivate(
    join(directory, "runtime.json"),
    JSON.stringify({ ...receipt, id: oldId }),
  );
  const networks = ["companion", "runtime"].map((purpose, index) => {
    const name =
      purpose === "runtime" ? names.sandbox : `${names.project}_default`;
    const id = String(index + 1).repeat(64);
    return { purpose, id, name };
  });
  for (const n of networks) {
    const intent = { ownerId: state.ownerId, purpose: n.purpose, name: n.name };
    await writePrivate(
      join(directory, `private/network-${n.purpose}-create.json`),
      JSON.stringify(intent),
    );
    await writePrivate(
      join(directory, `private/network-${n.purpose}-receipt.json`),
      JSON.stringify({ ...intent, id: n.id }),
    );
  }
  let target: { id: string; phase: string; generation?: string } | undefined = {
    id: oldId,
    phase: "Stopped",
  };
  let settingsRestored = false;
  let gateReleased = false;
  const behavior = {
    failCreate: false,
    loseCreateResponse: false,
    loseDeleteResponse: false,
    incompleteRestore: false,
    rejectSnapshot: false,
  };
  const effects: string[] = [];
  const row = () =>
    target
      ? {
          ...target,
          name: names.sandbox,
          workspace: "default",
          labels: {
            "clawscarf.installation": state.ownerId,
            ...(target.generation
              ? { "clawscarf.upgrade": target.generation }
              : {}),
          },
        }
      : undefined;
  const rpcSchema = z.object({
    action: z.string(),
    generation: z.string().optional(),
  });
  const command: typeof run = async (executable, args, options) => {
    if (executable === "/operator/python") {
      const request = rpcSchema.parse(JSON.parse(options?.input ?? ""));
      if (request.action === "snapshot")
        return JSON.stringify(
          behavior.rejectSnapshot
            ? { ok: false, code: "global_overrides_unsupported" }
            : {
                ok: true,
                value: {
                  create: "encoded-spec",
                  effective: "encoded-settings",
                  resourceVersion: "9223372036854775800",
                },
              },
        );
      if (request.action === "create") {
        assert.equal((await readUpgrade(directory))?.stage, "create_sent");
        effects.push("create");
        if (behavior.failCreate) throw Error("lost before observed allocation");
        assert.ok(request.generation);
        target = { id: newId, phase: "Ready", generation: request.generation };
        if (behavior.loseCreateResponse) throw Error("lost creation response");
      }
      if (request.action === "restore") {
        assert.equal((await readUpgrade(directory))?.stage, "restore_sent");
        effects.push("restore");
        if (behavior.incompleteRestore)
          throw Error("unknown partial setting update");
        settingsRestored = true;
      }
      if (request.action === "verify" && !settingsRestored)
        return JSON.stringify({ ok: false, code: "restoration_unverified" });
      return JSON.stringify({ ok: true, value: {} });
    }
    if (executable === state.input.openshellCli) {
      if (args[1] === "list") return JSON.stringify(target ? [row()] : []);
      if (args[1] === "get") return JSON.stringify(row());
      if (args[1] === "delete") {
        assert.equal((await readUpgrade(directory))?.stage, "delete_sent");
        effects.push("delete");
        target = undefined;
        if (behavior.loseDeleteResponse) throw Error("lost deletion response");
        return "";
      }
      assert.ok(target);
      if (args[1] === "stop") {
        effects.push("stop");
        target.phase = "Stopped";
        return "";
      }
      assert.fail("Upgrade must not start the application.");
    }
    assert.equal(executable, "docker");
    if (args[0] === "network") {
      if (args[1] === "ls")
        return networks
          .map((n) => JSON.stringify({ id: n.id, name: n.name }))
          .join("\n");
      const n = networks.find((v) => v.id === args.at(-1));
      assert.ok(n);
      return JSON.stringify({
        Id: n.id,
        Name: n.name,
        Driver: "bridge",
        Scope: "local",
        Internal: false,
        Ingress: false,
        Attachable: n.purpose === "runtime",
        EnableIPv6: false,
        Options: null,
        Labels: {
          "clawscarf.installation": state.ownerId,
          "clawscarf.network-purpose": n.purpose,
        },
        IPAM: {
          Driver: "default",
          Options: null,
          Config: [{ Gateway: "172.29.0.1" }],
        },
      });
    }
    if (args[0] === "image")
      return args.includes(
        '{{index .Config.Labels "io.clawscarf.execution-model"}}',
      )
        ? "team-runtime"
        : args.includes('{{index .Config.Labels "io.clawscarf.start-gate"}}')
          ? "1"
          : (args.at(-1) ?? "");
    if (args[0] === "volume")
      return JSON.stringify({
        Name: names.volume,
        Labels: { "clawscarf.installation": state.ownerId },
      });
    if (args[0] === "cp") {
      assert.equal((await stat(args[1] ?? "")).mode & 0o777, 0o644);
      assert.ok(settingsRestored);
      assert.equal(target?.phase, "Stopped");
      assert.equal(
        await readFile(args[1] ?? "", "utf8"),
        target?.generation + "\n",
      );
      gateReleased = true;
      effects.push("release");
      return "";
    }
    if (args[1] === "ls") {
      if (args.some((x) => x.includes("com.docker.compose"))) return "";
      if (args.some((x) => x.startsWith("id=")))
        return target?.id === oldId ? "d".repeat(64) : "";
      return target ? (target.id === oldId ? "d" : "e").repeat(64) : "";
    }
    assert.ok(target);
    return JSON.stringify({
      Id: (target.id === oldId ? "d" : "e").repeat(64),
      Image: target.id === oldId ? state.input.runtimeImage : newImage,
      Labels: {
        "openshell.ai/managed-by": "openshell",
        "openshell.ai/sandbox-id": target.id,
        "openshell.ai/sandbox-name": names.sandbox,
        "openshell.ai/sandbox-namespace": names.sandbox,
        "openshell.ai/sandbox-workspace": "default",
      },
      Mounts: [
        {
          Type: "volume",
          Name: names.volume,
          Destination: "/home/node",
          RW: true,
        },
      ],
    });
  };
  return {
    directory,
    state,
    effects,
    behavior,
    command,
    get gateReleased() {
      return gateReleased;
    },
  };
}

await test("replacement preserves records and stays stopped for its first boot with restored settings", async (t) => {
  const f = await fixture(t);
  f.behavior.loseCreateResponse = true;
  f.behavior.loseDeleteResponse = true;
  await upgradeLocal(
    f.directory,
    newImage,
    "/operator/python",
    () => {},
    f.command,
  );
  assert.equal(f.gateReleased, true);
  assert.deepEqual(f.effects, [
    "delete",
    "create",
    "restore",
    "stop",
    "release",
  ]);
  assert.equal((await readUpgrade(f.directory))?.stage, "complete");
  assert.equal((await readState(f.directory)).input.runtimeImage, newImage);
  assert.equal(
    z
      .object({ id: z.uuid() })
      .parse(
        JSON.parse(await readFile(join(f.directory, "runtime.json"), "utf8")),
      ).id,
    newId,
  );
  await requireNoUpgrade(f.directory);
  await upgradeLocal(
    f.directory,
    newImage,
    "/operator/python",
    () => {},
    f.command,
  );
  assert.equal(f.effects.filter((x) => x === "create").length, 1);
});

await test("uncertain absent allocation is never replayed and blocks normal startup", async (t) => {
  const f = await fixture(t);
  f.behavior.failCreate = true;
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      upgradeLocal(
        f.directory,
        newImage,
        "/operator/python",
        () => {},
        f.command,
      ),
    );
  assert.equal(f.effects.filter((x) => x === "create").length, 1);
  assert.equal(f.effects.filter((x) => x === "delete").length, 1);
  await assert.rejects(requireNoUpgrade(f.directory));
  assert.equal(f.gateReleased, false);
});

await test("unverified settings keep the gate closed and resume through the setting reconciler", async (t) => {
  const f = await fixture(t);
  f.behavior.incompleteRestore = true;
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      upgradeLocal(
        f.directory,
        newImage,
        "/operator/python",
        () => {},
        f.command,
      ),
    );
  assert.equal(f.effects.filter((x) => x === "restore").length, 2);
  assert.equal(f.gateReleased, false);
  assert.equal(
    (await readState(f.directory)).input.runtimeImage,
    f.state.input.runtimeImage,
  );
  f.behavior.incompleteRestore = false;
  await upgradeLocal(
    f.directory,
    newImage,
    "/operator/python",
    () => {},
    f.command,
  );
  assert.equal(f.gateReleased, true);
  assert.equal(f.effects.filter((x) => x === "create").length, 1);
});

await test("unobservable global overrides are refused before deleting compute", async (t) => {
  const f = await fixture(t);
  f.behavior.rejectSnapshot = true;
  await assert.rejects(
    upgradeLocal(
      f.directory,
      newImage,
      "/operator/python",
      () => {},
      f.command,
    ),
    /global overrides/,
  );
  assert.deepEqual(f.effects, []);
  assert.equal(await readUpgrade(f.directory), undefined);
});

await test("upgrade gate remains readable with a restrictive operator umask", async (t) => {
  const f = await fixture(t);
  const previous = process.umask(0o077);
  try {
    await upgradeLocal(
      f.directory,
      newImage,
      "/operator/python",
      () => {},
      f.command,
    );
    assert.equal(f.gateReleased, true);
  } finally {
    process.umask(previous);
  }
});
