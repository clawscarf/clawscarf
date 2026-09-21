import { oidcTeam } from "./oidc.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { verifyRuntimeBinding } from "../../scripts/deployment/runtime-binding.js";
import { verifyRuntimeImage } from "../../scripts/deployment/images.js";
import {
  readState,
  resourceNames,
  type LocalState,
} from "../../scripts/deployment/state.js";
import { LocalSetupError, type run } from "../../scripts/deployment/process.js";

function fixture() {
  const state: LocalState = {
    schemaVersion: 1,
    ownerId: "00000000-0000-4000-8000-000000000001",
    input: {
      name: "team",
      administratorName: "Admin",
      publicWeb: false,
      runtimeImage: `sha256:${"a".repeat(64)}`,
      companionImage: `sha256:${"b".repeat(64)}`,
      openshellCli: "/tools/openshell",
      openshellGateway: "/tools/gateway",
      openshellClientImage: `sha256:${"a".repeat(64)}`,
      team: oidcTeam(19000, 19002),
      ports: {
        controller: 17671,
        application: 19000,
        widgets: 19002,
        management: 19001,
        native: 19789,
        nativeWidgets: 19790,
        database: 15432,
      },
      cpu: "2",
      memory: "4Gi",
    },
  };
  const names = resourceNames(state);
  const target = {
    id: "00000000-0000-4000-8000-000000000002",
    name: names.sandbox,
  };
  const home = {
    Type: "volume",
    Name: names.volume,
    Destination: "/home/node",
    RW: true,
  };
  const actual = {
    Id: "c".repeat(64),
    Image: state.input.runtimeImage,
    Labels: {
      "openshell.ai/managed-by": "openshell",
      "openshell.ai/sandbox-id": target.id,
      "openshell.ai/sandbox-name": target.name,
      "openshell.ai/sandbox-namespace": names.sandbox,
      "openshell.ai/sandbox-workspace": "default",
    },
    Mounts: [home],
  };
  const volume = {
    Name: names.volume,
    Labels: { "clawscarf.installation": state.ownerId },
  };
  const listing = [actual.Id];
  const command: typeof run = (executable, args) => {
    assert.equal(executable, "docker");
    assert.ok(
      ["ls", "inspect"].includes(args[1] ?? ""),
      "Observation must never mutate Docker.",
    );
    if (args[0] === "image") return Promise.resolve(state.input.runtimeImage);
    if (args[0] === "volume") return Promise.resolve(JSON.stringify(volume));
    if (args[1] === "ls") return Promise.resolve(listing.join("\n"));
    assert.equal(args.at(-1), "c".repeat(64));
    return Promise.resolve(JSON.stringify(actual));
  };
  return { state, target, actual, home, volume, listing, command };
}
function failure(code: string) {
  return (error: unknown) =>
    error instanceof LocalSetupError &&
    error.code === code &&
    !error.message.includes("secret");
}
await test("runtime selection requires the packaged execution contract without changing the image", async () => {
  const image = `sha256:${"a".repeat(64)}`;
  for (const label of ["team-runtime\n", "", "other-runtime"])
    if (label.trim() === "team-runtime")
      await verifyRuntimeImage(image, (executable, args) => {
        assert.equal(executable, "docker");
        assert.deepEqual(args, [
          "image",
          "inspect",
          "--format",
          '{{index .Config.Labels "io.clawscarf.execution-model"}}',
          image,
        ]);
        return Promise.resolve(label);
      });
    else
      await assert.rejects(
        verifyRuntimeImage(image, () => Promise.resolve(label)),
        failure("configuration_changed"),
      );
});
await test("runtime verification observes the actual immutable image and owned writable home without mutations", async () => {
  const f = fixture();
  assert.deepEqual(await verifyRuntimeBinding(f.state, f.target, f.command), {
    containerId: f.actual.Id,
    imageId: f.actual.Image,
  });
});
await test("wrong identities, images and volume bindings cannot authorize native entry", async () => {
  for (const modify of [
    (f: ReturnType<typeof fixture>) => {
      f.actual.Id = "d".repeat(64);
    },
    (f: ReturnType<typeof fixture>) => {
      f.actual.Image = `sha256:${"d".repeat(64)}`;
    },
    (f: ReturnType<typeof fixture>) => {
      f.actual.Labels["openshell.ai/sandbox-id"] = "foreign";
    },
    (f: ReturnType<typeof fixture>) => {
      f.actual.Labels["openshell.ai/sandbox-namespace"] = "foreign";
    },
    (f: ReturnType<typeof fixture>) => {
      f.home.Name = "foreign";
    },
    (f: ReturnType<typeof fixture>) => {
      f.home.Type = "bind";
    },
    (f: ReturnType<typeof fixture>) => {
      f.home.RW = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.actual.Mounts = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.actual.Mounts.push({ ...f.home });
    },
    (f: ReturnType<typeof fixture>) => {
      f.actual.Mounts.push({
        ...f.home,
        Destination: "/home/node/.openclaw",
        Name: "shadow-volume",
      });
    },
    (f: ReturnType<typeof fixture>) => {
      f.volume.Labels["clawscarf.installation"] = "foreign";
    },
    (f: ReturnType<typeof fixture>) => {
      f.listing.push("d".repeat(64));
    },
    (f: ReturnType<typeof fixture>) => {
      f.listing.length = 0;
    },
  ]) {
    const f = fixture();
    modify(f);
    await assert.rejects(
      verifyRuntimeBinding(f.state, f.target, f.command),
      failure("runtime_binding_changed"),
    );
  }
});
await test("incomplete observations fail safely without exposing Docker diagnostics", async () => {
  const f = fixture();
  await assert.rejects(
    verifyRuntimeBinding(f.state, f.target, () =>
      Promise.reject(Error("secret payload")),
    ),
    failure("runtime_binding_unavailable"),
  );
  await assert.rejects(
    verifyRuntimeBinding(f.state, f.target, () => Promise.resolve("invalid")),
    failure("runtime_binding_unavailable"),
  );
});

const configured = process.env.CLAWSCARF_TEST_LOCAL_BINDING_DIRECTORY;
await test(
  "read-only binding check of an existing real Docker-driver runtime",
  { skip: !configured },
  async () => {
    assert.ok(configured);
    const state = await readState(configured);
    const target = z
      .object({
        id: z.uuid(),
        name: z.string(),
        ownerId: z.literal(state.ownerId),
      })
      .parse(
        JSON.parse(await readFile(join(configured, "runtime.json"), "utf8")),
      );
    const binding = await verifyRuntimeBinding(state, target);
    assert.match(binding.containerId, /^[a-f0-9]{64}$/);
  },
);
