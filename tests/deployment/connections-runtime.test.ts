import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { z } from "zod";
import {
  connectionsConfigurationInputSchema,
  type ConnectionsConfigurationResult,
} from "../../runtime/connections-configuration.js";
import { parseLocalInput } from "../../scripts/deployment/configuration.js";
import { launchLocal } from "../../scripts/deployment/launch.js";
import {
  loadInitialConnections,
  prepareInitialConnections,
} from "../../scripts/deployment/connections.js";
import {
  operateConnectionsRuntime,
  requireNoConnectionsChange,
} from "../../scripts/deployment/connections-runtime.js";
import { LocalSetupError, type run } from "../../scripts/deployment/process.js";
import {
  initializeState,
  resourceNames,
  writePrivate,
} from "../../scripts/deployment/state.js";

const brokerUrl = "https://broker.example:9443/team";
const token = "scoped-runtime-token-kept-out-of-argv";
const runtimeId = "00000000-0000-4000-8000-000000000002";
const containerId = "d".repeat(64);
const changeSchema = z.object({
  ownerId: z.uuid(),
  id: z.uuid(),
  digest: z.string(),
  state: z.enum(["pending", "complete"]),
});
function hasCode(code: string) {
  return (error: unknown) =>
    error instanceof LocalSetupError &&
    error.code === code &&
    !error.message.includes(token);
}
async function missing(path: string) {
  await assert.rejects(
    stat(path),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "ENOENT",
  );
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-connections-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "installation");
  const input = parseLocalInput({
    name: "test",
    administratorName: "Ada",
    runtimeImage: `sha256:${"a".repeat(64)}`,
    companionImage: `sha256:${"b".repeat(64)}`,
    openshellCli: "/operator/openshell",
    openshellGateway: "/operator/gateway",
    openshellClientImage: `sha256:${"a".repeat(64)}`,
    cpu: "2",
    memory: "2Gi",
    ports: {
      controller: 17671,
      application: 18800,
      widgets: 18802,
      management: 18801,
      native: 18789,
      nativeWidgets: 18790,
      database: 15432,
    },
    connections: { mode: "external", brokerUrl },
  });
  const state = await initializeState(directory, input);
  await prepareInitialConnections(
    directory,
    await loadInitialConnections(input.connections),
  );
  const serverId = randomUUID();
  await writePrivate(
    join(directory, "identity.json"),
    JSON.stringify({ serverId }),
  );
  await writePrivate(
    join(directory, "prepared.json"),
    JSON.stringify({ ownerId: state.ownerId }),
  );
  const names = resourceNames(state);
  const intent = {
    ownerId: state.ownerId,
    name: names.sandbox,
    image: input.runtimeImage,
  };
  await writePrivate(
    join(directory, "runtime-create.json"),
    JSON.stringify(intent),
  );
  await writePrivate(
    join(directory, "runtime.json"),
    JSON.stringify({ ...intent, id: runtimeId }),
  );
  const credentialFile = join(root, "runtime-token");
  await writePrivate(credentialFile, token + "\n");
  const changePath = join(directory, "connections-configuration.json");
  const desiredPath = join(directory, "private/connections-runtime.json");
  const behavior: {
    companionRunning: boolean;
    runtimePresent: boolean;
    phase: string;
    targetId: string;
    targetOwner: string;
    volumeOwner: string;
    volumeBusy: boolean;
    containerImage: string;
    containerVolume: string;
    loseResponse: boolean;
    result: ConnectionsConfigurationResult;
  } = {
    companionRunning: false,
    runtimePresent: true,
    phase: "Stopped",
    targetId: runtimeId,
    targetOwner: state.ownerId,
    volumeOwner: state.ownerId,
    volumeBusy: false,
    containerImage: input.runtimeImage,
    containerVolume: names.volume,
    loseResponse: false,
    result: {
      state: "configured",
      enabled: true,
      brokerUrl,
      configHash: "native-hash",
      credentialMatches: true,
    },
  };
  const helperCalls: Array<
    z.infer<typeof connectionsConfigurationInputSchema>
  > = [];
  const calls: Array<{ executable: string; args: readonly string[] }> = [];
  const row = () => ({
    id: behavior.targetId,
    name: names.sandbox,
    phase: behavior.phase,
    workspace: "default",
    labels: { "clawscarf.installation": behavior.targetOwner },
  });
  const readChange = async () =>
    changeSchema.parse(JSON.parse(await readFile(changePath, "utf8")));
  const command: typeof run = async (executable, args, options) => {
    calls.push({ executable, args: [...args] });
    assert.equal(JSON.stringify(args).includes(token), false);
    assert.equal(JSON.stringify(options?.env ?? {}).includes(token), false);
    if (executable === input.openshellCli) {
      assert.equal(
        options?.env?.XDG_CONFIG_HOME,
        join(directory, "controller/config"),
      );
      if (args[1] === "list")
        return JSON.stringify(behavior.runtimePresent ? [row()] : []);
      if (args[1] === "get") return JSON.stringify(row());
      assert.fail("Runtime configuration may only observe the controller.");
    }
    assert.equal(executable, "docker");
    if (args[0] === "run") {
      const request = connectionsConfigurationInputSchema.parse(
        JSON.parse(options?.input ?? ""),
      );
      helperCalls.push(request);
      assert.equal(request.ownerId, state.ownerId);
      assert.equal(request.serverId, serverId);
      assert.equal(request.brokerUrl, brokerUrl);
      assert.equal(options?.timeout, 60000);
      assert.ok(args.includes("none"));
      assert.ok(args.includes("--read-only"));
      assert.ok(args.includes("--pull") && args.includes("never"));
      assert.ok(args.includes("1000:1000"));
      assert.equal(args.at(-1), "/app/clawscarf/configure-connections-main.js");
      assert.ok(args.includes(input.runtimeImage));
      const mount = `type=volume,source=${names.volume},target=/home/node,volume-nocopy`;
      assert.ok(
        args.includes(mount + (request.kind === "observe" ? ",readonly" : "")),
      );
      if (request.kind === "configure") {
        const journal = await readChange();
        assert.equal(journal.ownerId, state.ownerId);
        assert.equal(journal.state, "pending");
        assert.equal(request.credential?.token, token);
        assert.equal((await stat(desiredPath)).mode & 0o777, 0o600);
        await assert.rejects(
          requireNoConnectionsChange(directory, state.ownerId),
          hasCode("connections_configuration_pending"),
        );
      }
      if (behavior.loseResponse) throw Error("lost response " + token);
      return JSON.stringify(behavior.result);
    }
    if (args[0] === "image") return input.runtimeImage;
    if (args[0] === "volume")
      return JSON.stringify({
        Name: names.volume,
        Labels: { "clawscarf.installation": behavior.volumeOwner },
      });
    if (args[0] === "container" && args[1] === "ls") {
      if (args.some((value) => value.includes("com.docker.compose")))
        return behavior.companionRunning ? "running-companion" : "";
      if (args.some((value) => value.startsWith("volume=")))
        return behavior.volumeBusy ? "unrelated-running-container" : "";
      return containerId;
    }
    if (args[0] === "container" && args[1] === "inspect")
      return JSON.stringify({
        Id: containerId,
        Image: behavior.containerImage,
        Labels: {
          "openshell.ai/managed-by": "openshell",
          "openshell.ai/sandbox-id": behavior.targetId,
          "openshell.ai/sandbox-name": names.sandbox,
          "openshell.ai/sandbox-namespace": names.sandbox,
          "openshell.ai/sandbox-workspace": "default",
        },
        Mounts: [
          {
            Type: "volume",
            Name: behavior.containerVolume,
            Destination: "/home/node",
            RW: true,
          },
        ],
      });
    assert.fail("Unexpected command: " + JSON.stringify(args));
  };
  return {
    directory,
    state,
    names,
    credentialFile,
    changePath,
    desiredPath,
    behavior,
    helperCalls,
    calls,
    command,
    readChange,
  };
}

await test("Connections configuration requires the recorded stopped runtime, idle companion and exact owned image/home", async (t) => {
  for (const scenario of [
    {
      name: "running companion",
      change: { companionRunning: true },
      code: "connections_configuration_refused",
    },
    {
      name: "running runtime",
      change: { phase: "Ready" },
      code: "connections_configuration_refused",
    },
    {
      name: "absent recorded runtime",
      change: { runtimePresent: false },
      code: "connections_configuration_refused",
    },
    {
      name: "replacement runtime",
      change: { targetId: randomUUID() },
      code: "connections_configuration_refused",
    },
    {
      name: "foreign runtime owner",
      change: { targetOwner: randomUUID() },
      code: "runtime_identity_changed",
    },
    {
      name: "foreign volume owner",
      change: { volumeOwner: randomUUID() },
      code: "runtime_binding_changed",
    },
    {
      name: "wrong image",
      change: { containerImage: `sha256:${"c".repeat(64)}` },
      code: "runtime_binding_changed",
    },
    {
      name: "wrong home",
      change: { containerVolume: "another-home" },
      code: "runtime_binding_changed",
    },
    {
      name: "volume mounted by another container",
      change: { volumeBusy: true },
      code: "connections_configuration_refused",
    },
  ])
    await t.test(scenario.name, async (t) => {
      const f = await fixture(t);
      Object.assign(f.behavior, scenario.change);
      await assert.rejects(
        operateConnectionsRuntime(
          f.directory,
          { kind: "configure", credentialFile: f.credentialFile },
          f.command,
        ),
        hasCode(scenario.code),
      );
      assert.equal(f.helperCalls.length, 0);
      await missing(f.changePath);
      await missing(f.desiredPath);
    });
});

await test("only an entirely unallocated runtime may configure its prepared home without a runtime receipt", async (t) => {
  const f = await fixture(t);
  await rm(join(f.directory, "runtime.json"));
  f.behavior.runtimePresent = false;
  await assert.rejects(
    operateConnectionsRuntime(
      f.directory,
      { kind: "configure", credentialFile: f.credentialFile },
      f.command,
    ),
    hasCode("connections_configuration_refused"),
  );
  assert.equal(f.helperCalls.length, 0);
  await rm(join(f.directory, "runtime-create.json"));
  f.behavior.volumeOwner = randomUUID();
  await assert.rejects(
    operateConnectionsRuntime(
      f.directory,
      { kind: "configure", credentialFile: f.credentialFile },
      f.command,
    ),
    hasCode("connections_configuration_refused"),
  );
  f.behavior.volumeOwner = f.state.ownerId;
  await operateConnectionsRuntime(
    f.directory,
    { kind: "configure", credentialFile: f.credentialFile },
    f.command,
  );
  assert.equal(f.helperCalls.length, 1);
});

await test("lost helper response retains a pending journal, observe cannot clear it, explicit reconfiguration completes without automatic retries", async (t) => {
  const f = await fixture(t);
  f.behavior.loseResponse = true;
  await assert.rejects(
    operateConnectionsRuntime(
      f.directory,
      { kind: "configure", credentialFile: f.credentialFile },
      f.command,
    ),
    hasCode("connections_configuration_pending"),
  );
  assert.equal(f.helperCalls.length, 1);
  const pending = await f.readChange();
  assert.equal(pending.state, "pending");
  await assert.rejects(
    requireNoConnectionsChange(f.directory, f.state.ownerId),
    hasCode("connections_configuration_pending"),
  );
  await assert.rejects(
    launchLocal(f.directory, () =>
      assert.fail("Pending configuration must not start local services."),
    ),
    hasCode("connections_configuration_pending"),
  );
  const before = {
    journal: await readFile(f.changePath),
    desired: await readFile(f.desiredPath),
  };
  f.behavior.loseResponse = false;
  const observed = await operateConnectionsRuntime(
    f.directory,
    { kind: "observe" },
    f.command,
  );
  assert.equal(observed.restartRequired, false);
  assert.equal(f.helperCalls.length, 2);
  assert.equal(f.helperCalls[1]?.kind, "observe");
  assert.deepEqual(await readFile(f.changePath), before.journal);
  assert.deepEqual(await readFile(f.desiredPath), before.desired);
  await assert.rejects(
    requireNoConnectionsChange(f.directory, f.state.ownerId),
    hasCode("connections_configuration_pending"),
  );
  const configured = await operateConnectionsRuntime(
    f.directory,
    { kind: "configure", credentialFile: f.credentialFile },
    f.command,
  );
  assert.equal(configured.restartRequired, true);
  assert.equal(f.helperCalls.length, 3);
  const complete = await f.readChange();
  assert.equal(complete.state, "complete");
  assert.notEqual(complete.id, pending.id);
  await requireNoConnectionsChange(f.directory, f.state.ownerId);
  assert.equal(JSON.stringify(configured).includes(token), false);
  assert.equal(JSON.stringify(complete).includes(token), false);
  assert.equal(f.calls.filter((call) => call.args[0] === "run").length, 3);
});

await test("observation is read-only before initial activation and preserves disabled native configuration", async (t) => {
  const f = await fixture(t);
  f.behavior.result = {
    state: "unconfigured",
    enabled: false,
    expectedPackage: true,
  };
  const observed = await operateConnectionsRuntime(
    f.directory,
    { kind: "observe" },
    f.command,
  );
  assert.deepEqual(observed, { ...f.behavior.result, restartRequired: false });
  assert.equal(f.helperCalls[0]?.credential, undefined);
  await missing(f.changePath);
  await missing(f.desiredPath);
  f.behavior.loseResponse = true;
  await assert.rejects(
    operateConnectionsRuntime(f.directory, { kind: "observe" }, f.command),
    hasCode("connections_configuration_unavailable"),
  );
  await missing(f.changePath);
  await missing(f.desiredPath);
  f.behavior.loseResponse = false;
  f.behavior.result = {
    state: "configured",
    enabled: false,
    brokerUrl,
    configHash: "native-hash",
    credentialMatches: true,
  };
  const configured = await operateConnectionsRuntime(
    f.directory,
    { kind: "configure", credentialFile: f.credentialFile },
    f.command,
  );
  assert.equal(configured.state, "configured");
  assert.ok("enabled" in configured && !configured.enabled);
  await requireNoConnectionsChange(f.directory, f.state.ownerId);
});

await test("invalid private credentials fail before the journal or native mutation; an unverified result remains pending", async (t) => {
  const f = await fixture(t);
  await chmod(f.credentialFile, 0o644);
  await assert.rejects(
    operateConnectionsRuntime(
      f.directory,
      { kind: "configure", credentialFile: f.credentialFile },
      f.command,
    ),
  );
  assert.equal(f.helperCalls.length, 0);
  await missing(f.changePath);
  await missing(f.desiredPath);
  await chmod(f.credentialFile, 0o600);
  f.behavior.result = {
    state: "configured",
    enabled: true,
    brokerUrl,
    configHash: "native-hash",
    credentialMatches: false,
  };
  await assert.rejects(
    operateConnectionsRuntime(
      f.directory,
      { kind: "configure", credentialFile: f.credentialFile },
      f.command,
    ),
    hasCode("connections_configuration_pending"),
  );
  assert.equal(f.helperCalls.length, 1);
  await assert.rejects(
    requireNoConnectionsChange(f.directory, f.state.ownerId),
    hasCode("connections_configuration_pending"),
  );
});
