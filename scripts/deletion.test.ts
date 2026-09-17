import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { confirmDeletion, deleteInstallation } from "./installation/delete.js";
import {
  InstallerCancelled,
  SectionCancelled,
} from "./installation/installer/prompts.js";
import { initializeState, resourceNames } from "./deployment/state.js";
import { run } from "./deployment/process.js";

await test("deletion requires both confirmations; declining or Esc cancels", async () => {
  for (const answers of [[false], [true, false], [true, true]]) {
    let calls = 0;
    const attempt = confirmDeletion(
      "/tmp/team/state",
      {},
      {
        confirm: (_message, initial) => {
          assert.equal(initial, false);
          return Promise.resolve(answers[calls++] ?? false);
        },
      },
    );
    if (answers.every(Boolean)) await attempt;
    else await assert.rejects(attempt, InstallerCancelled);
    assert.equal(calls, answers.length);
  }
  await assert.rejects(
    confirmDeletion(
      "/tmp/team/state",
      {},
      {
        confirm: () => Promise.reject(new SectionCancelled()),
      },
    ),
    InstallerCancelled,
  );
  for (const options of [
    { confirmDelete: "/tmp/team/state" },
    { acceptDataLoss: true },
    { confirmDelete: "/tmp/other/state", acceptDataLoss: true },
  ])
    await assert.rejects(confirmDeletion("/tmp/team/state", options));
  await confirmDeletion("/tmp/team/state", {
    confirmDelete: "/tmp/team/state",
    acceptDataLoss: true,
  });
});

const image = process.env.CLAWSCARF_TEST_DELETE_IMAGE;
await test(
  "delete removes only owned Docker resources and can resume a partial deletion",
  { skip: !image },
  async (t) => {
    assert.ok(image);
    const root = await mkdtemp(join(tmpdir(), "clawscarf-delete-"));
    const directory = join(root, "state");
    const state = await initializeState(directory, {
      name: "delete-test",
      administratorName: "Ada",
      runtimeImage: `sha256:${"a".repeat(64)}`,
      companionImage: `sha256:${"b".repeat(64)}`,
      openshellClientImage: `sha256:${"a".repeat(64)}`,
      openshellCli: "/tools/openshell",
      openshellGateway: "/tools/gateway",
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
    const names = resourceNames(state);
    const label = `clawscarf.installation=${state.ownerId}`;
    const resources: {
      container: string[];
      volume: string[];
      network: string[];
    } = { container: [], volume: [], network: [] };
    t.after(async () => {
      for (const id of resources.container)
        await run("docker", ["container", "rm", "--force", id]).catch(() => {});
      for (const kind of ["volume", "network"] as const)
        for (const id of resources[kind])
          await run("docker", [kind, "rm", id]).catch(() => {});
      await rm(root, { recursive: true, force: true });
    });
    const volume = (
      await run("docker", ["volume", "create", "--label", label])
    ).trim();
    resources.volume.push(volume);
    const foreignVolume = (
      await run("docker", [
        "volume",
        "create",
        "--label",
        `clawscarf.test=${state.ownerId}`,
      ])
    ).trim();
    resources.volume.push(foreignVolume);
    const network = (
      await run("docker", [
        "network",
        "create",
        "--label",
        label,
        names.project,
      ])
    ).trim();
    resources.network.push(network);
    const container = async (args: string[]) => {
      const id = (
        await run("docker", [
          "run",
          "-d",
          ...args,
          "--entrypoint",
          "/bin/sh",
          image,
          "-c",
          "trap 'exit 0' TERM; while :; do sleep 1; done",
        ])
      ).trim();
      resources.container.push(id);
      return id;
    };
    const managed = await container([
      "--label",
      label,
      "--network",
      network,
      "--volume",
      `${volume}:/data`,
    ]);
    const ca = join(directory, "controller/tls/ca.crt");
    await mkdir(join(directory, "controller/tls"), { recursive: true });
    await writeFile(ca, "fixture");
    const sandbox = await container([
      "--label",
      `openshell.ai/sandbox-namespace=${names.sandbox}`,
      "--label",
      "openshell.ai/managed-by=openshell",
      "--mount",
      `type=bind,source=${ca},target=/etc/openshell/tls/client/ca.crt,readonly`,
    ]);
    // A colliding Compose project name is not sufficient evidence of ownership.
    const foreign = await container([
      "--label",
      `com.docker.compose.project=${names.project}`,
      "--volume",
      `${foreignVolume}:/data`,
    ]);
    const marker = join(directory, "prepared.json");
    await writeFile(marker, "{}");
    await assert.rejects(deleteInstallation(directory), /does not belong/);
    await access(marker);
    assert.equal(
      (
        await run("docker", [
          "inspect",
          "--format",
          "{{.State.Running}}",
          managed,
        ])
      ).trim(),
      "true",
    );
    await run("docker", ["rm", "--force", foreign]);
    // A foreign container using an owned volume must not be killed to force its removal.
    const outside = await container([
      "--volume",
      `${volume}:/shared`,
      "--volume",
      `${foreignVolume}:/data`,
    ]);
    await assert.rejects(deleteInstallation(directory));
    await access(join(directory, "installation.json"));
    await assert.rejects(access(marker));
    assert.equal(
      (
        await run("docker", [
          "inspect",
          "--format",
          "{{.State.Running}}",
          outside,
        ])
      ).trim(),
      "true",
    );
    await run("docker", ["rm", "--force", outside]);
    const result: unknown = JSON.parse(
      await run(process.execPath, [
        "--import",
        "tsx",
        "scripts/clawscarf.ts",
        "stop",
        "--state",
        directory,
        "--delete",
        "--confirm-delete",
        directory,
        "--accept-data-loss",
        "--json",
      ]),
    );
    assert.deepEqual(result, { state: "deleted", stateDirectory: directory });
    for (const id of [managed, sandbox])
      await assert.rejects(run("docker", ["container", "inspect", id]));
    await assert.rejects(run("docker", ["volume", "inspect", volume]));
    await assert.rejects(run("docker", ["network", "inspect", network]));
    await run("docker", ["volume", "inspect", foreignVolume]);
    await access(join(directory, "installation.json"));
    assert.equal((await deleteInstallation(directory)).state, "deleted");
  },
);
