import { oidcTeam } from "./oidc.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureRuntime,
  stopRuntime,
} from "../../scripts/deployment/runtime.js";
import {
  resourceNames,
  type LocalState,
} from "../../scripts/deployment/state.js";
import { LocalSetupError, type run } from "../../scripts/deployment/process.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-local-runtime-"));
  const state: LocalState = {
    schemaVersion: 1,
    ownerId: randomUUID(),
    input: {
      name: "team",
      administratorName: "Admin",
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
  const name = resourceNames(state).sandbox;
  type Target = {
    id: string;
    name: string;
    phase: string;
    workspace: string;
    labels: Record<string, string>;
  };
  let target: Target | undefined;
  let loseCreate = false,
    createAbsent = false,
    replaceOnStop = false;
  const calls: string[][] = [];
  const command: typeof run = async (executable, args) => {
    assert.equal(executable, state.input.openshellCli);
    calls.push([...args]);
    assert.equal(args[args.indexOf("--gateway") + 1], name);
    const action = args[1];
    if (action === "list") return JSON.stringify(target ? [target] : []);
    if (action === "get") return JSON.stringify(target);
    if (action === "create") {
      const intent: unknown = JSON.parse(
        await readFile(join(directory, "runtime-create.json"), "utf8"),
      );
      assert.deepEqual(intent, {
        ownerId: state.ownerId,
        name,
        image: state.input.runtimeImage,
      });
      assert.equal(args[args.indexOf("--from") + 1], state.input.runtimeImage);
      assert.ok(args.includes("--no-auto-providers"));
      assert.ok(args.includes("--no-tty"));
      assert.ok(args.includes("--detach"));
      assert.deepEqual(args.slice(args.indexOf("--") + 1), [
        "/app/clawscarf/bin/openclaw",
        "gateway",
      ]);
      const mounts: unknown = JSON.parse(
        args[args.indexOf("--driver-config-json") + 1] ?? "",
      );
      assert.deepEqual(mounts, {
        docker: {
          mounts: [
            {
              type: "volume",
              source: resourceNames(state).volume,
              target: "/home/node",
              read_only: false,
            },
          ],
        },
      });
      if (!createAbsent)
        target = {
          id: randomUUID(),
          name,
          phase: "Ready",
          workspace: "default",
          labels: { "clawscarf.installation": state.ownerId },
        };
      if (loseCreate || createAbsent)
        throw Error("secret vendor output must not escape");
      return "created";
    }
    assert.ok(target);
    if (action === "stop") {
      target.phase = "Stopped";
      if (replaceOnStop) target.id = randomUUID();
      return "stopped";
    }
    if (action === "start") {
      target.phase = "Ready";
      return "started";
    }
    throw Error("Unexpected command");
  };
  return {
    directory,
    state,
    command,
    calls,
    getTarget: () => target,
    get target() {
      return target;
    },
    set target(value: Target | undefined) {
      target = value;
    },
    set loseCreate(value: boolean) {
      loseCreate = value;
    },
    set createAbsent(value: boolean) {
      createAbsent = value;
    },
    set replaceOnStop(value: boolean) {
      replaceOnStop = value;
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
const code = (expected: string) => (error: unknown) =>
  error instanceof LocalSetupError && error.code === expected;
await test("runtime records intent before allocation, resumes and stops only its observed UUID", async () => {
  const f = await fixture();
  try {
    const first = await ensureRuntime(f.directory, f.state, {}, f.command);
    assert.deepEqual(
      await ensureRuntime(f.directory, f.state, {}, f.command),
      first,
    );
    assert.equal(f.calls.filter((c) => c[1] === "create").length, 1);
    await stopRuntime(f.directory, f.state, {}, f.command);
    assert.equal(f.target?.phase, "Stopped");
    const resumed = await ensureRuntime(f.directory, f.state, {}, f.command);
    assert.equal(resumed.id, first.id);
    assert.equal(resumed.phase, "Ready");
    assert.equal(f.calls.filter((c) => c[1] === "create").length, 1);
  } finally {
    await f.cleanup();
  }
});
await test("lost create response reconciles target but never replays an absent uncertain allocation", async () => {
  const f = await fixture();
  try {
    f.loseCreate = true;
    assert.equal(
      (await ensureRuntime(f.directory, f.state, {}, f.command)).phase,
      "Ready",
    );
  } finally {
    await f.cleanup();
  }
  const missing = await fixture();
  try {
    missing.createAbsent = true;
    await assert.rejects(
      ensureRuntime(missing.directory, missing.state, {}, missing.command),
      code("runtime_outcome_unknown"),
    );
    await assert.rejects(
      ensureRuntime(missing.directory, missing.state, {}, missing.command),
      code("runtime_outcome_unknown"),
    );
    assert.equal(missing.calls.filter((c) => c[1] === "create").length, 1);
  } finally {
    await missing.cleanup();
  }
});
await test("foreign ownership, replacement UUID and terminal errors never trigger replacement", async () => {
  const f = await fixture();
  try {
    f.target = {
      id: randomUUID(),
      name: resourceNames(f.state).sandbox,
      workspace: "default",
      phase: "Ready",
      labels: { "clawscarf.installation": randomUUID() },
    };
    await assert.rejects(
      ensureRuntime(f.directory, f.state, {}, f.command),
      code("runtime_identity_changed"),
    );
    assert.equal(
      f.calls.filter((c) => ["create", "start", "stop"].includes(c[1] ?? ""))
        .length,
      0,
    );
    f.target = undefined;
    await ensureRuntime(f.directory, f.state, {}, f.command);
    const current = f.getTarget();
    assert.ok(current);
    current.phase = "Error";
    await assert.rejects(
      ensureRuntime(f.directory, f.state, {}, f.command),
      code("runtime_failed"),
    );
    current.phase = "Ready";
    current.id = randomUUID();
    await assert.rejects(
      stopRuntime(f.directory, f.state, {}, f.command),
      code("runtime_identity_changed"),
    );
    assert.equal(f.calls.filter((c) => c[1] === "stop").length, 0);
  } finally {
    await f.cleanup();
  }
});
await test("name-only stop detects replacement after dispatch and never reports success", async () => {
  const f = await fixture();
  try {
    await ensureRuntime(f.directory, f.state, {}, f.command);
    f.replaceOnStop = true;
    await assert.rejects(
      stopRuntime(f.directory, f.state, {}, f.command),
      code("runtime_identity_changed"),
    );
    assert.equal(f.calls.filter((c) => c[1] === "stop").length, 1);
  } finally {
    await f.cleanup();
  }
});

await test("runtime lookup follows all pages and finds its existing target after 100 other sandboxes", async () => {
  const f = await fixture();
  try {
    const first = await ensureRuntime(f.directory, f.state, {}, f.command);
    const preceding = Array.from({ length: 105 }, (_, i) => ({
      id: randomUUID(),
      name: `other-${String(i)}`,
      workspace: "default",
      phase: "Ready",
      labels: {},
    }));
    const offsets: number[] = [];
    const command: typeof run = async (executable, args, options) => {
      if (args[1] !== "list") return f.command(executable, args, options);
      const offset = Number(args[args.indexOf("--offset") + 1]);
      const limit = Number(args[args.indexOf("--limit") + 1]);
      offsets.push(offset);
      assert.equal(limit, 100);
      return JSON.stringify(
        [...preceding, f.getTarget()].slice(offset, offset + limit),
      );
    };
    assert.deepEqual(
      await ensureRuntime(f.directory, f.state, {}, command),
      first,
    );
    assert.deepEqual(offsets, [0, 100]);
    assert.equal(f.calls.filter((c) => c[1] === "create").length, 1);
  } finally {
    await f.cleanup();
  }
});
await test("failed, malformed or repeated later pages never imply absence or dispatch creation", async () => {
  for (const failure of ["failed", "malformed", "repeated"]) {
    const f = await fixture();
    try {
      const rows = Array.from({ length: 100 }, (_, i) => ({
        id: randomUUID(),
        name: `other-${String(i)}`,
        workspace: "default",
        phase: "Ready",
        labels: {},
      }));
      const command: typeof run = async (executable, args, options) => {
        if (args[1] !== "list") return f.command(executable, args, options);
        const offset = Number(args[args.indexOf("--offset") + 1]);
        if (offset === 0) return JSON.stringify(rows);
        assert.equal(offset, 100);
        if (failure === "failed")
          throw new LocalSetupError("command_failed", "Lookup failed");
        if (failure === "malformed") return '{"incomplete":true}';
        return JSON.stringify(rows);
      };
      await assert.rejects(ensureRuntime(f.directory, f.state, {}, command));
      assert.equal(
        f.calls.filter((c) => ["create", "start", "stop"].includes(c[1] ?? ""))
          .length,
        0,
      );
      await assert.rejects(
        readFile(join(f.directory, "runtime-create.json")),
        (error: unknown) =>
          error instanceof Error && "code" in error && error.code === "ENOENT",
      );
    } finally {
      await f.cleanup();
    }
  }
});
