import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, type TestContext } from "node:test";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { collectInstallation } from "./installation/installer/collect.js";
import { saveConfiguration } from "./installation/installer/inputs.js";
import {
  InstallerCancelled,
  type InstallerPrompts,
  type Choice,
} from "./installation/installer/prompts.js";
import { installFromAnswers } from "./installation/installer/run.js";
import { installationSchema } from "./installation/configuration.js";
import { planInstallation, applyInstallation } from "./installation/plan.js";
import { fingerprint, readJson } from "./installation/files.js";
import { liteLlmImage, postgresImage } from "./local/images.js";

await test("cancelling progress settles the current operation and prevents continuation", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { progress, InstallerCancelled } from './scripts/installation/installer/prompts.ts';
    let settled = false;
    const operation = progress('Preparing fixture', async () => {
      process.emit('SIGINT');
      await new Promise(resolve => setTimeout(resolve, 10));
      settled = true;
    });
    await assert.rejects(operation, InstallerCancelled);
    assert.equal(settled, true);
    console.log('Cancellation preserved the outcome');
  `,
    ],
    { timeout: 15000 },
  );
  assert.match(stdout, /Cancellation preserved the outcome/);
});

class Answers implements InstallerPrompts {
  notes: string[] = [];
  questions: string[] = [];
  constructor(private values: Record<string, string | string[] | boolean>) {}
  async text(
    message: string,
    initial?: string,
    validate?: (
      value: string,
    ) => string | undefined | Promise<string | undefined>,
  ) {
    this.questions.push(message);
    const value = this.values[message] ?? initial;
    assert.equal(typeof value, "string", message);
    if (typeof value !== "string") throw Error(message);
    if (validate) assert.equal(await validate(value), undefined, message);
    return value;
  }
  select(message: string, choices: Choice[]) {
    this.questions.push(message);
    const value = this.values[message];
    assert.ok(
      choices.some((choice) => choice.value === value),
      message,
    );
    if (typeof value !== "string") throw Error(message);
    return Promise.resolve(value);
  }
  multiselect(message: string, choices: Choice[]) {
    const value = this.values[message];
    assert.ok(Array.isArray(value));
    assert.ok(
      value.every((item) => choices.some((choice) => choice.value === item)),
    );
    return Promise.resolve(value);
  }
  confirm(message: string) {
    this.questions.push(message);
    const value = this.values[message] ?? false;
    assert.equal(typeof value, "boolean");
    return Promise.resolve(value === true);
  }
  note(message: string, title: string) {
    this.notes.push(`${title}\n${message}`);
  }
}
async function fixture(t: TestContext) {
  const parent = await mkdtemp(join(tmpdir(), "cs-wiz-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const release = join(parent, "release.json"),
    directory = join(parent, "new");
  const executable = "#!/bin/sh\nexit 0\n";
  await writeFile(join(parent, "tool"), executable, { mode: 0o700 });
  const tool = { file: "tool", sha256: fingerprint(executable) };
  const image = `sha256:${"a".repeat(64)}`;
  await writeFile(
    release,
    JSON.stringify({
      schemaVersion: 1,
      version: "0.1.0-dev",
      sourceRevision: "a".repeat(40),
      platforms: ["darwin-arm64"],
      images: {
        postgres: postgresImage,
        models: liteLlmImage,
        gateway: image,
        companion: image,
        worker: image,
        relay: image,
      },
      tools: { openshell: { version: "0.0.116", cli: tool, gateway: tool } },
    }),
  );
  const answers = {
    Access: "local",
    Models: "disabled",
    Connections: "disabled",
    Continue: "save",
    [`Save configuration and private credential copies in ${directory}?`]: true,
  };
  return { parent, release, directory, answers };
}
const local = {
  skip: process.platform !== "darwin" || process.arch !== "arm64",
};

await test(
  "wizard save-only uses the real planner, creates private files and never invokes Docker or apply",
  local,
  async (t) => {
    const f = await fixture(t);
    const ui = new Answers(f.answers);
    const result = await installFromAnswers(f, ui);
    assert.equal(result.state, "saved");
    const config = installationSchema.parse(
      await readJson(join(f.directory, "installation.json")),
    );
    assert.deepEqual(config.models, { mode: "disabled" });
    assert.deepEqual(config.connections, { mode: "disabled" });
    assert.ok(config.resources.worker);
    assert.deepEqual(config.packs, []);
    assert.equal(
      (await planInstallation(join(f.directory, "installation.json"))).action,
      "prepare",
    );
    for (const [path, mode] of [
      [f.directory, 0o700],
      [join(f.directory, "installation.json"), 0o600],
      [join(f.directory, "preview.json"), 0o600],
    ] as const)
      assert.equal((await lstat(path)).mode & 0o777, mode);
    await assert.rejects(lstat(join(f.directory, "state")), { code: "ENOENT" });
    assert.ok(!ui.questions.some((question) => question.includes("key file")));
    const before = await readFile(join(f.directory, "installation.json"));
    await assert.rejects(installFromAnswers(f, new Answers(f.answers)), {
      code: "change_unsupported",
    });
    assert.deepEqual(
      await readFile(join(f.directory, "installation.json")),
      before,
    );
  },
);

await test(
  "declining the wizard before save leaves no files",
  local,
  async (t) => {
    const f = await fixture(t);
    const ui = new Answers({
      ...f.answers,
      [`Save configuration and private credential copies in ${f.directory}?`]: false,
    });
    assert.deepEqual(await installFromAnswers(f, ui), { state: "cancelled" });
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
  },
);

await test(
  "OIDC wizard matches the registered callbacks and imports secrets without displaying them",
  local,
  async (t) => {
    const f = await fixture(t);
    const key = join(f.parent, "key");
    await writeFile(key, "private-test-secret", { mode: 0o600 });
    const ui = new Answers({
      ...f.answers,
      Access: "oidc",
      "Application HTTPS origin": "https://team.example.test:8443",
      "Widgets HTTPS origin (separate listener port)":
        "https://widgets.example.test:8445",
      "TLS certificate file": key,
      "TLS private key file": key,
      "OIDC issuer": "https://identity.example.test",
      "OIDC client ID": "team",
      "OIDC client secret file": key,
      "Administrator OIDC subject ID": "owner-subject",
      "Administrator email": "owner@example.test",
    });
    const { config } = await collectInstallation(ui, f);
    const path = await saveConfiguration(f.directory, config);
    assert.ok(!ui.notes.join().includes("private-test-secret"));
    const json = await readFile(path, "utf8");
    assert.ok(!json.includes("private-test-secret"));
    const contract =
      (await readFile("services/access/openapi.json", "utf8")) +
      (await readFile("services/access/runtime/http.ts", "utf8"));
    for (const endpoint of ["/_clawscarf/callback", "/_clawscarf/signed-out"]) {
      assert.ok(contract.includes(`"${endpoint}"`));
      assert.ok(
        ui.notes.join().includes(`https://team.example.test:8443${endpoint}`),
      );
    }
    for (const name of ["oidc-client-secret", "tls-key.pem"]) {
      const saved = join(f.directory, "secrets", name);
      assert.equal(await readFile(saved, "utf8"), "private-test-secret");
      assert.equal((await lstat(saved)).mode & 0o777, 0o600);
    }
  },
);

await test(
  "optional capabilities use the real model and pack contracts and reject changed private inputs at apply",
  local,
  async (t) => {
    const f = await fixture(t);
    const modelFile = join(f.parent, "models.json"),
      key = join(f.parent, "key");
    await writeFile(
      modelFile,
      JSON.stringify({
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
      }),
    );
    await writeFile(key, "PROVIDER_KEY=private-test-secret\n", { mode: 0o600 });
    const ui = new Answers({
      ...f.answers,
      Models: "litellm",
      Connections: "external",
      "Model configuration file": modelFile,
      "Provider credentials file (.env)": key,
      "Connections broker URL": "https://broker.example.test",
      "Scoped broker key file": key,
      "Install a pack? (experimental native Claws)": true,
      "Pack directory": resolve("packs/research-team"),
      "Pack agents": ["researcher", "reviewer"],
      "Python executable with the pinned OpenShell SDK": "/usr/bin/python3",
    });
    const result = await installFromAnswers(f, ui);
    assert.equal(result.state, "saved");
    const configFile = join(f.directory, "installation.json"),
      planFile = join(f.directory, "preview.json");
    const plan = await planInstallation(configFile);
    assert.equal(plan.capabilities.models, "litellm");
    assert.equal(plan.capabilities.connections, "external");
    assert.deepEqual(plan.capabilities.packs[0]?.members, [
      "researcher",
      "reviewer",
    ]);
    assert.ok(!JSON.stringify(plan).includes("private-test-secret"));
    await writeFile(
      join(f.directory, "secrets/models.env"),
      "PROVIDER_KEY=changed\n",
    );
    await assert.rejects(applyInstallation(configFile, planFile), {
      code: "stale_plan",
    });
  },
);

await test(
  "credential imports refuse public files and symlinks before creating the destination",
  local,
  async (t) => {
    const f = await fixture(t);
    const { config } = await collectInstallation(new Answers(f.answers), f);
    const key = join(f.parent, "key");
    await writeFile(key, "private-test-secret", { mode: 0o644 });
    config.connections = {
      mode: "external",
      brokerUrl: "https://broker.example.test",
      credentialFile: key,
    };
    await assert.rejects(saveConfiguration(f.directory, config), {
      code: "invalid_configuration",
    });
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
    await chmod(key, 0o600);
    const linked = join(f.parent, "linked");
    await symlink(key, linked);
    config.connections.credentialFile = linked;
    await assert.rejects(saveConfiguration(f.directory, config));
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
  },
);

await test(
  "prepare/start uses the shared operators in order and never starts after failed or cancelled apply",
  local,
  async (t) => {
    for (const fail of [false, true, "cancel"] as const) {
      const f = await fixture(t);
      const calls: string[] = [];
      const ui = new Answers({ ...f.answers, Continue: "start" });
      const work = installFromAnswers(f, ui, {
        plan: planInstallation,
        doctor: () => {
          calls.push("doctor");
          return Promise.resolve({
            state: "prerequisites_available",
            platform: "darwin-arm64",
            release: "0.1.0-dev",
            images: 5,
          });
        },
        apply: async (config, plan) => {
          calls.push("apply");
          assert.equal(config, join(f.directory, "installation.json"));
          assert.equal(plan, join(f.directory, "preview.json"));
          await readJson(plan);
          if (fail === "cancel") throw new InstallerCancelled();
          if (fail) throw Error("Fixture failure");
          return {
            state: "prepared",
            directory: f.directory,
            release: "0.1.0-dev",
          };
        },
        start: (state) => {
          calls.push("start");
          assert.equal(state, join(f.directory, "state"));
          return Promise.resolve();
        },
      });
      if (fail) await assert.rejects(work);
      else assert.equal((await work).state, "stopped");
      assert.deepEqual(
        calls,
        fail ? ["doctor", "apply"] : ["doctor", "apply", "start"],
      );
      assert.ok(
        !(
          await readFile(join(f.directory, "installation.json"), "utf8")
        ).includes("private-test-secret"),
      );
    }
  },
);
