import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installationSchema } from "./installation/configuration.js";
import { releaseSchema } from "./release/definition.js";
import { fingerprint } from "./installation/files.js";
import { planInstallation, applyInstallation } from "./installation/plan.js";
import { resolveInstallation } from "./installation/resolve.js";
import { initializeState, withInstallationLock } from "./deployment/state.js";
import { liteLlmImage, postgresImage } from "./deployment/images.js";
import {
  planSettingsChange,
  reconfigureInstallation,
} from "./installation/reconfigure.js";
import { prepareModelGateway } from "./deployment/model-gateway.js";
import { readState } from "./deployment/state.js";

const configuration = {
  schemaVersion: 1,
  name: "team",
  releaseFile: "release.json",
  stateDirectory: "state",
  exposure: { mode: "local", applicationPort: 18800, widgetPort: 18802 },
  access: {
    mode: "oidc",
    administratorName: "Owner",
    issuer: "https://issuer.example.test",
    clientId: "fixture",
    clientSecretFile: "keys.env",
  },
  resources: {
    runtime: { cpu: "2", memory: "2Gi" },
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
      images: {
        postgres: postgresImage,
        models: liteLlmImage,
        gateway: image,
        companion: image,
        openshellClient: image,
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
    assert.equal(new Set(plan.internalPorts).size, 7);
    await writeFile(
      join(directory, "connections-registration.json"),
      JSON.stringify({
        cloudUrl: "https://broker.example.test",
        request: {
          reference: randomUUID(),
          name: "team",
          origin: null,
          managementSecret: "m".repeat(43),
          runtimeSecret: "r".repeat(43),
        },
        accountId: randomUUID(),
        installationId: randomUUID(),
      }),
      { mode: 0o600 },
    );
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
          mode: "hosted",
          cloudUrl: "https://broker.example.test",
          registrationFile: "connections-registration.json",
        },
      }),
    );
    const enabled = await planInstallation(path);
    assert.equal(enabled.capabilities.models, "litellm");
    assert.equal(enabled.capabilities.connections, "hosted");
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
      JSON.stringify(resolved.release),
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
    // The public command must recover its private candidate without requiring a file argument.
    const { saveConfiguration } = await import("./installation/save.js");
    const { resolveConfigurationInputs } =
      await import("./installation/configure.js");
    const { editInstallationSettings } =
      await import("./installation/installer/settings.js");
    const { unattendedPrompts } =
      await import("./installation/installer/prompts.js");
    const stateDirectory = join(directory, "state");
    const accepted = {
      ...resolveConfigurationInputs(
        installationSchema.parse(configuration),
        directory,
      ),
      stateDirectory,
    };
    await writeFile(
      join(stateDirectory, "settings.json"),
      JSON.stringify(accepted),
    );
    const changedSettings = await planSettingsChange(path);
    assert.deepEqual(changedSettings.scopes, {
      models: false,
      connections: false,
      publicWeb: false,
      packs: false,
    });
    assert.deepEqual((await planSettingsChange(path, "models")).scopes, {
      models: true,
      connections: false,
      publicWeb: false,
      packs: false,
    });
    const candidate = await saveConfiguration(
      join(stateDirectory, `.settings-${randomUUID()}`),
      accepted,
      undefined,
      true,
    );
    const interrupted = await planSettingsChange(candidate);
    await writeFile(
      join(stateDirectory, "prepared.json"),
      JSON.stringify({
        ownerId: retained.ownerId,
        settingsPending: interrupted.desired.fingerprint,
        settingsCandidate: candidate,
      }),
    );
    const prompts: string[] = [];
    const result = await editInstallationSettings(stateDirectory, {
      ...unattendedPrompts,
      note() {},
      confirm(message) {
        prompts.push(message);
        return Promise.resolve(false);
      },
    });
    assert.equal(result.state, "cancelled");
    assert.deepEqual(prompts, ["Resume this interrupted change?"]);
    assert.ok(await readFile(candidate));
    await assert.rejects(
      editInstallationSettings(stateDirectory, unattendedPrompts, {
        nonInteractive: true,
        yes: true,
        connections: true,
      }),
      { code: "change_unsupported" },
    );
    assert.ok(await readFile(candidate));
    await writeFile(
      join(stateDirectory, "prepared.json"),
      JSON.stringify({ ownerId: retained.ownerId }),
    );
    await withInstallationLock(changedSettings.directory, () =>
      assert.rejects(
        reconfigureInstallation(path, changedSettings.fingerprint),
        { code: "operation_busy" },
      ),
    );
    const nativeFile = join(modelRoot, "native.json");
    const native: unknown = JSON.parse(await readFile(nativeFile, "utf8"));
    assert.ok(typeof native === "object" && native !== null);
    await writeFile(
      nativeFile,
      JSON.stringify({
        ...native,
        baseUrl: "https://retained.example.test:8443/v1",
      }),
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
    assert.match(
      await readFile(nativeFile, "utf8"),
      /https:\/\/retained.example.test:8443\/v1/,
    );
    const retainedNative = await readFile(join(modelRoot, "native.json"));
    await writeFile(
      path,
      JSON.stringify({
        ...configuration,
        resources: {
          ...configuration.resources,
          runtime: { cpu: "4", memory: "4Gi" },
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
    const { startInstallation } = await import("./installation/lifecycle.js");
    const { upgradeLocal } = await import("./deployment/upgrade.js");
    for (const operation of [
      () => withInstallationLock(state, () => Promise.resolve(undefined)),
      () => startInstallation(state, () => {}),
      () => upgradeLocal(state, "unused", "unused", () => {}),
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

await test("configuration and lifecycle commands share a home-directory default; runtime selection is recipe-owned", async () => {
  const { installationCommand } = await import("./installation/command.js");
  const { homedir } = await import("node:os");
  const commands = installationCommand().commands;
  for (const name of ["configure", "start", "stop", "status", "logs"]) {
    const command = commands.find((item) => item.name() === name);
    assert.ok(command);
    assert.equal(
      command.opts()["directory"],
      join(homedir(), "clawscarf-team"),
    );
    assert.ok(!command.options.some((option) => option.long === "--release"));
  }
});
