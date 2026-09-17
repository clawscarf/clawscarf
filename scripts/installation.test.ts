import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  chmod,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installationSchema } from "./installation/configuration.js";
import { releaseSchema } from "./release/definition.js";
import { fingerprint } from "./installation/files.js";
import { planInstallation, applyInstallation } from "./installation/plan.js";
import { resolveInstallation } from "./installation/resolve.js";
import { initializeState, withInstallationLock } from "./local/state.js";
import { liteLlmImage, postgresImage } from "./local/images.js";
import {
  planSettingsChange,
  reconfigureInstallation,
} from "./installation/reconfigure.js";
import { prepareModelGateway } from "./local/model-gateway.js";
import { readState } from "./local/state.js";
import { monitoredServices } from "./local/logs.js";
import { monitorComposeServices } from "./local/service-monitors.js";

const configuration = {
  schemaVersion: 1,
  name: "team",
  releaseFile: "release.json",
  stateDirectory: "state",
  exposure: { mode: "local", applicationPort: 18800, widgetPort: 18802 },
  access: { mode: "local", administratorName: "Owner" },
  resources: {
    gateway: { cpu: "2", memory: "2Gi" },
    worker: { cpu: "2", memory: "2Gi" },
  },
  browser: { enabled: false },
  models: {
    mode: "litellm",
    configurationFile: "models.json",
    upstreamEnvironmentFile: "keys.env",
  },
  connections: { mode: "disabled" },
  packs: [],
};
await test("product configuration never offers protection bypasses or invalid access combinations", () => {
  assert.ok(installationSchema.safeParse(configuration).success);
  for (const modification of [
    { models: { mode: "disabled" } },
    { execution: { mode: "host" } },
    { resources: { gateway: { cpu: "2", memory: "2Gi" } } },
    { access: { mode: "external" } },
    { browser: { enabled: true, sandbox: false } },
    { storage: { mode: "directory", root: "/tmp" } },
  ])
    assert.equal(
      installationSchema.safeParse({ ...configuration, ...modification })
        .success,
      false,
    );
});
await test("release file requires exact images, complete protection tools and supported platforms", () => {
  assert.equal(
    releaseSchema.safeParse({
      version: "0.1.0",
      images: { gateway: "image:latest" },
    }).success,
    false,
  );
});
await test(
  "preview rejects changed release inputs before resource allocation",
  { skip: process.platform !== "darwin" || process.arch !== "arm64" },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-plan-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const executable = "#!/bin/sh\nexit 0\n";
    await writeFile(join(directory, "tool"), executable, { mode: 0o700 });
    const tool = { file: "tool", sha256: fingerprint(executable) };
    const image = `sha256:${"a".repeat(64)}`;
    const release = {
      schemaVersion: 1,
      version: "0.1.0",
      sourceRevision: "a".repeat(40),
      platforms: ["darwin-arm64"],
      recipes: [],
      packs: [],
      images: {
        postgres: postgresImage,
        models: liteLlmImage,
        gateway: image,
        worker: image,
        companion: image,
        relay: image,
      },
      tools: { openshell: { version: "0.0.116", cli: tool, gateway: tool } },
    };
    await writeFile(join(directory, "release.json"), JSON.stringify(release));
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify(configuration));
    const modelFile = {
      defaultModel: "team",
      models: [
        {
          id: "team",
          name: "Team",
          enabled: true,
          contextWindow: 8192,
          maxTokens: 1024,
          reasoning: false,
          tools: true,
          input: ["text"],
          route: { model: "openai/test", apiKeyEnv: "PROVIDER_KEY" },
        },
      ],
    };
    await writeFile(join(directory, "models.json"), JSON.stringify(modelFile));
    await writeFile(
      join(directory, "keys.env"),
      "PROVIDER_KEY=private-test-key\n",
      { mode: 0o600 },
    );
    const plan = await planInstallation(path);
    assert.equal(plan.action, "prepare");
    assert.equal(plan.stateDirectory, join(directory, "state"));
    assert.equal(new Set(plan.internalPorts).size, 8);
    await writeFile(join(directory, "connection-key"), "private-scoped-token", {
      mode: 0o600,
    });
    await writeFile(
      path,
      JSON.stringify({
        ...configuration,
        models: {
          mode: "litellm",
          configurationFile: "models.json",
          upstreamEnvironmentFile: "keys.env",
        },
        connections: {
          mode: "external",
          brokerUrl: "https://broker.example.test",
          credentialFile: "connection-key",
        },
      }),
    );
    const enabled = await planInstallation(path);
    assert.equal(enabled.capabilities.models, "litellm");
    assert.equal(enabled.capabilities.connections, "external");
    assert.ok(!JSON.stringify(enabled).includes("private-test-key"));
    const enabledPreview = join(directory, "enabled.json");
    await writeFile(enabledPreview, JSON.stringify(enabled));
    await withInstallationLock(enabled.stateDirectory, () =>
      assert.rejects(applyInstallation(path, enabledPreview), {
        code: "operation_busy",
      }),
    );
    await writeFile(join(directory, "keys.env"), "PROVIDER_KEY=changed\n");
    await assert.rejects(applyInstallation(path, enabledPreview), {
      code: "stale_plan",
    });
    await writeFile(path, JSON.stringify(configuration));
    const resolved = await resolveInstallation(path, plan.internalPorts);
    assert.ok(resolved.input.models);
    assert.equal(resolved.input.connections, undefined);
    assert.ok(resolved.input.modelGateway);
    const preview = join(directory, "preview.json");
    await writeFile(preview, JSON.stringify(plan));
    await writeFile(
      join(directory, "release.json"),
      JSON.stringify({ ...release, version: "0.2.0" }),
    );
    await assert.rejects(applyInstallation(path, preview), {
      code: "stale_plan",
    });
    await writeFile(join(directory, "release.json"), JSON.stringify(release));
    await initializeState(join(directory, "state"), resolved.input);
    await writeFile(
      join(directory, "state/inputs.sha256"),
      "different-input-revision",
    );
    await assert.rejects(planInstallation(path), {
      code: "change_unsupported",
    });
    const retained = await readState(join(directory, "state"));
    await writeFile(
      join(directory, "state/release.json"),
      JSON.stringify(release),
    );
    await writeFile(
      join(directory, "state/packs.json"),
      JSON.stringify(resolved.packSelection),
    );
    await prepareModelGateway(join(directory, "state"), retained);
    const modelRoot = join(directory, "state/private/models");
    const master = await readFile(join(modelRoot, "master-key"), "utf8");
    await writeFile(join(modelRoot, "runtime-key"), "sk-existing-revoked-key", {
      mode: 0o600,
    });
    await writeFile(
      join(directory, "models.json"),
      JSON.stringify({ ...modelFile, thinkingDefault: "medium" }),
    );
    await writeFile(
      join(directory, "state/prepared.json"),
      JSON.stringify({ ownerId: retained.ownerId }),
    );
    const changedSettings = await planSettingsChange(path);
    await withInstallationLock(changedSettings.directory, () =>
      assert.rejects(
        reconfigureInstallation(path, changedSettings.fingerprint),
        { code: "operation_busy" },
      ),
    );
    await prepareModelGateway(
      join(directory, "state"),
      { ...retained, input: changedSettings.desired.input },
      { replaceConfiguration: true },
    );
    assert.equal(await readFile(join(modelRoot, "master-key"), "utf8"), master);
    assert.equal(
      await readFile(join(modelRoot, "runtime-key"), "utf8"),
      "sk-existing-revoked-key",
    );
    assert.match(
      await readFile(join(modelRoot, "native.json"), "utf8"),
      /"thinkingDefault":"medium"/,
    );
    const retainedNative = await readFile(join(modelRoot, "native.json"));
    await writeFile(
      path,
      JSON.stringify({
        ...configuration,
        resources: {
          ...configuration.resources,
          gateway: { cpu: "4", memory: "4Gi" },
        },
      }),
    );
    await assert.rejects(planSettingsChange(path), {
      code: "change_unsupported",
    });
    await writeFile(path, JSON.stringify(configuration));
    await writeFile(
      join(directory, "models.json"),
      JSON.stringify({
        ...modelFile,
        defaultModel: "another",
        models: modelFile.models.map((model) => ({ ...model, id: "another" })),
      }),
    );
    const differentModel = await planSettingsChange(path);
    assert.notEqual(differentModel.fingerprint, changedSettings.fingerprint);
    await writeFile(
      join(directory, "state/inputs.sha256"),
      "new-accepted-revision",
    );
    assert.notEqual(
      (await planSettingsChange(path)).fingerprint,
      differentModel.fingerprint,
    );
    await writeFile(
      join(directory, "state/prepared.json"),
      JSON.stringify({
        ownerId: retained.ownerId,
        settingsPending: differentModel.desired.fingerprint,
      }),
    );
    assert.equal((await planSettingsChange(path)).resuming, true);
    await writeFile(
      join(directory, "keys.env"),
      "PROVIDER_KEY=changed-again\n",
    );
    await assert.rejects(planSettingsChange(path), {
      code: "change_unsupported",
    });
    assert.deepEqual(
      await readFile(join(modelRoot, "native.json")),
      retainedNative,
    );
    await writeFile(join(directory, "models.json"), JSON.stringify(modelFile));
    await writeFile(join(directory, "tool"), "changed");
    await assert.rejects(planInstallation(path), { code: "release_mismatch" });
  },
);
await test("concurrent operators cannot mutate the same installation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = join(directory, "state");
  await withInstallationLock(state, async () => {
    const { superviseInstallation } =
      await import("./installation/lifecycle.js");
    const { upgradeLocal } = await import("./local/upgrade.js");
    const { operateConnectionsRuntime } =
      await import("./local/connections-runtime.js");
    for (const operation of [
      () => withInstallationLock(state, () => Promise.resolve(undefined)),
      () => superviseInstallation(state, () => {}),
      () => upgradeLocal(state, "unused", "unused", () => {}),
      () => operateConnectionsRuntime(state, { kind: "observe" }),
      () =>
        operateConnectionsRuntime(state, {
          kind: "configure",
          credentialFile: "unused",
        }),
    ])
      await assert.rejects(operation(), { code: "operation_busy" });
  });
  await assert.rejects(
    withInstallationLock(state, () =>
      Promise.reject(new Error("operation failed")),
    ),
    /operation failed/,
  );
  await withInstallationLock(state, () => Promise.resolve(undefined));
});

await test("lifecycle refuses unprotected component assemblies and reports no supervisor truthfully", async (t) => {
  const { initializeState } = await import("./local/state.js");
  const { parseLocalInput } = await import("./local/configuration.js");
  const { controlInstallation, startInstallation, installationLogs } =
    await import("./installation/lifecycle.js");
  const parent = await mkdtemp(join(tmpdir(), "cs-lifecycle-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "state");
  await initializeState(
    directory,
    parseLocalInput({
      name: "test",
      administratorName: "Owner",
      runtimeImage: `sha256:${"a".repeat(64)}`,
      companionImage: `sha256:${"a".repeat(64)}`,
      openshellCli: "/tmp/unused",
      openshellGateway: "/tmp/unused",
      ports: {
        controller: 17671,
        application: 18800,
        widgets: 18802,
        management: 18801,
        native: 18789,
        nativeWidgets: 18790,
        database: 15432,
      },
      cpu: "1",
      memory: "1Gi",
    }),
  );
  assert.deepEqual(await controlInstallation(directory, "status"), {
    supervisor: "not_running",
    ready: false,
  });
  await assert.rejects(controlInstallation(directory, "stop"), {
    code: "not_running",
  });
  await assert.rejects(
    startInstallation(directory, () => undefined),
    { code: "invalid_configuration" },
  );
  await assert.rejects(
    installationLogs(directory, "../../private/encryption.key"),
  );
  await mkdir(join(directory, "logs"));
  await monitorComposeServices(
    directory,
    monitoredServices,
    async (_command, args, filename) => {
      const service = args.at(-1);
      const content = `${service ?? "unknown"} stopped`;
      await writeFile(join(directory, "logs", filename), content);
      assert.equal(
        await installationLogs(directory, filename.slice(0, -4)),
        content,
      );
    },
  );
});

await test("private lifecycle control distinguishes pending administrator and ready service without stopping on status", async (t) => {
  const { controlInstallation } = await import("./installation/lifecycle.js");
  const { parseLocalInput } = await import("./local/configuration.js");
  const parent = await mkdtemp(join(tmpdir(), "cs-control-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "state");
  await initializeState(
    directory,
    parseLocalInput({
      name: "test",
      administratorName: "Owner",
      runtimeImage: `sha256:${"a".repeat(64)}`,
      companionImage: `sha256:${"a".repeat(64)}`,
      openshellCli: "/tmp/unused",
      openshellGateway: "/tmp/unused",
      ports: {
        controller: 17671,
        application: 18800,
        widgets: 18802,
        management: 18801,
        native: 18789,
        nativeWidgets: 18790,
        database: 15432,
      },
      cpu: "1",
      memory: "1Gi",
    }),
  );
  let complete = false;
  let stops = 0;
  const server = createServer((request, response) => {
    const stopping = request.method === "POST" && request.url === "/stop";
    if (stopping) stops += 1;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        supervisor: stopping ? "stopping" : "running",
        ready: !stopping && complete,
        administrator: stopping
          ? "unavailable"
          : complete
            ? "ready"
            : "pending",
        packs: [],
      }),
    );
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      ),
  );
  const socket = join(directory, "operator.sock");
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  await chmod(socket, 0o600);
  assert.deepEqual(await controlInstallation(directory, "status"), {
    supervisor: "running",
    ready: false,
    administrator: "pending",
    packs: [],
  });
  complete = true;
  assert.deepEqual(await controlInstallation(directory, "status"), {
    supervisor: "running",
    ready: true,
    administrator: "ready",
    packs: [],
  });
  assert.equal(stops, 0);
  assert.equal(
    (await controlInstallation(directory, "stop")).supervisor,
    "stopping",
  );
  assert.equal(stops, 1);
  await chmod(socket, 0o666);
  await assert.rejects(controlInstallation(directory, "status"), {
    code: "unavailable",
  });
});
