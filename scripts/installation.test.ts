import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installationSchema } from "./installation/configuration.js";
import { releaseSchema } from "./release/definition.js";
import { fingerprint } from "./installation/files.js";
import {
  planInstallation,
  applyInstallation,
  withInstallationLock,
} from "./installation/plan.js";
import { resolveInstallation } from "./installation/resolve.js";
import { initializeState } from "./local/state.js";
import { liteLlmImage, postgresImage } from "./local/images.js";

const configuration = {
  schemaVersion: 1,
  name: "team",
  releaseFile: "release.json",
  stateDirectory: "state",
  storage: { mode: "docker-volumes" },
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
    await writeFile(join(directory, "tool"), "changed");
    await assert.rejects(planInstallation(path), { code: "release_mismatch" });
  },
);
await test("concurrent operators cannot mutate the same installation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = join(directory, "state");
  await mkdir(state, { mode: 0o700 });
  await withInstallationLock(state, async () => {
    await assert.rejects(
      withInstallationLock(state, () => Promise.resolve(undefined)),
      { code: "operation_busy" },
    );
  });
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
});
