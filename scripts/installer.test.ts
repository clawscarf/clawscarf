import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, type TestContext } from "node:test";
import {
  chmod,
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { collectInstallation } from "./installation/installer/collect.js";
import { saveConfiguration } from "./installation/save.js";
import {
  InstallerCancelled,
  SectionCancelled,
  type InstallerPrompts,
  type Choice,
} from "./installation/installer/prompts.js";
import { installFromAnswers } from "./installation/installer/run.js";
import { installationSchema } from "./installation/configuration.js";
import { planInstallation, applyInstallation } from "./installation/plan.js";
import { fingerprint, readJson } from "./installation/files.js";
import { liteLlmImage, postgresImage } from "./deployment/images.js";

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
  constructor(
    private values: Record<string, string | string[] | boolean>,
    private menu: string[] = [],
  ) {}
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
  password(message: string) {
    return this.text(`secret:${message}`);
  }
  select(message: string, choices: Choice[], initial?: string) {
    assert.ok(!choices.some((choice) => /^Back\b/.test(choice.label)));
    this.questions.push(message);
    const value =
      message === "Review installation"
        ? (this.values[message] ?? initial)
        : message.endsWith("— configure installation") ||
            message.endsWith("— settings")
          ? (this.menu.shift() ?? "review")
          : (this.values[message] ?? initial);
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
  confirm(message: string, initial = false) {
    this.questions.push(message);
    const value =
      this.values[message] ?? (message === "Save section changes?" || initial);
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
      cloudUrl: "https://cloud.example.test",
      sourceRevision: "a".repeat(40),
      platforms: ["darwin-arm64"],
      recipes: [],
      images: {
        postgres: postgresImage,
        models: liteLlmImage,
        gateway: image,
        companion: image,
        openshellClient: image,
      },
      tools: { openshell: { version: "0.0.116", cli: tool, gateway: tool } },
    }),
  );
  const models = join(parent, "initial-models.json");
  await writeFile(
    models,
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
  const env = join(parent, "initial-models.env");
  await writeFile(env, "PROVIDER_KEY=test-key\n", { mode: 0o600 });
  const answers = {
    "Starting point": "custom",
    Access: "local",
    "Default model": "team",
    Provider: "openai/test",
    "Model catalog": "file",
    "Model catalog file": models,
    "secret:OpenAI LLM API key": "test-key",
    Connections: "off",
    "Start now?": false,
    [`Install in ${directory}?`]: true,
  };
  return {
    parent,
    release,
    directory,
    answers,
    oidcIssuer: "https://issuer.example.test",
    oidcClientId: "fixture",
    oidcSecretFile: env,
    modelCatalog: models,
    providerEnvFile: env,
  };
}
async function savePreview(
  options: Parameters<typeof collectInstallation>[1],
  ui: InstallerPrompts,
) {
  const draft = await collectInstallation(ui, options);
  const configFile = await saveConfiguration(
    draft.directory,
    draft.config,
    draft.inputs,
  );
  const planFile = join(draft.directory, "preview.json");
  await writeFile(
    planFile,
    JSON.stringify(await planInstallation(configFile)),
    { mode: 0o600 },
  );
  return { state: "saved", configFile, planFile };
}
const local = {
  skip: process.platform !== "darwin" || process.arch !== "arm64",
};

await test(
  "collected settings use the real planner and save private files without applying",
  local,
  async (t) => {
    const f = await fixture(t);
    const ui = new Answers(f.answers);
    const result = await savePreview(f, ui);
    assert.equal(result.state, "saved");
    const config = installationSchema.parse(
      await readJson(join(f.directory, "installation.json")),
    );
    assert.equal(config.models.mode, "litellm");
    assert.equal(config.connections.mode, "disabled");
    assert.ok(config.resources.runtime);
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
    await assert.rejects(savePreview(f, new Answers(f.answers)), {
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
      [`Install in ${f.directory}?`]: false,
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
    const ui = new Answers(
      {
        ...f.answers,
        "Use your own OIDC provider?": true,
        "Make this server available over HTTPS?": true,
        "Application HTTPS origin": "https://team.example.test:8443",
        "Widgets HTTPS origin": "https://widgets.example.test:8445",
        "TLS certificate file": key,
        "TLS private key file": key,
        "OIDC issuer": "https://identity.example.test",
        "OIDC client ID": "team",
        "OIDC client secret": "file",
        "OIDC client secret file": key,
      },
      ["exposure", "access"],
    );
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
    const ui = new Answers(
      {
        ...f.answers,
        "Default model": "team",
        Provider: "openai/test",
        "Model catalog file": modelFile,
        "LLM API keys": "file",
        "Provider credentials file (.env)": key,
        "Install a pack? (experimental native Claws)": true,
        "Pack directory": resolve("packs/research-team"),
        "Pack agents": ["researcher", "reviewer"],
        "Python executable with the pinned OpenShell SDK": "/usr/bin/python3",
      },
      ["advanced-models", "packs"],
    );
    const result = await savePreview(f, ui);
    assert.equal(result.state, "saved");
    const configFile = join(f.directory, "installation.json"),
      planFile = join(f.directory, "preview.json");
    const plan = await planInstallation(configFile);
    assert.equal(plan.capabilities.models, "litellm");
    assert.equal(plan.capabilities.connections, "disabled");
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
    config.models = {
      mode: "external",
      configurationFile: config.models.configurationFile,
      credentialFile: key,
    };
    await assert.rejects(saveConfiguration(f.directory, config), {
      code: "invalid_configuration",
    });
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
    await chmod(key, 0o600);
    const linked = join(f.parent, "linked");
    await symlink(key, linked);
    config.models.credentialFile = linked;
    await assert.rejects(saveConfiguration(f.directory, config));
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
  },
);

await test(
  "prepare/start uses the shared operators in order and never starts after failed or cancelled apply",
  local,
  async (t) => {
    for (const nonInteractive of [false, true])
      for (const fail of [false, true, "cancel"] as const) {
        const f = await fixture(t);
        const calls: string[] = [];
        let links = 0;
        const answers: Record<string, string | string[] | boolean> = {
          ...f.answers,
        };
        delete answers["Start now?"];
        const ui = new Answers(answers);
        const { unattendedPrompts } =
          await import("./installation/installer/prompts.js");
        const work = installFromAnswers(
          nonInteractive ? { ...f, recipe: "custom", nonInteractive: true } : f,
          nonInteractive
            ? {
                ...unattendedPrompts,
                note: (message, title) => {
                  ui.note(message, title);
                },
              }
            : ui,
          {
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
              return Promise.resolve({
                state: "running" as const,
                ready: true,
                packs: [],
                administrator: "ready" as const,
                services: [],
              });
            },
            register: async () => {},
            administrator: (_state, issue) => {
              if (issue) {
                links++;
                return Promise.resolve({
                  url: "http://127.0.0.1:18800/_clawscarf/login?setup=fixture",
                  complete: false,
                  expiresAt: new Date(Date.now() + 300_000).toISOString(),
                });
              }
              if (links === 0)
                return Promise.resolve({ complete: false, expiresAt: null });
              if (links === 1) {
                calls.push("login-expired");
                return Promise.resolve({
                  complete: false,
                  expiresAt: new Date(0).toISOString(),
                });
              }
              calls.push("login-complete");
              return Promise.resolve({ complete: true, expiresAt: null });
            },
          },
        );
        if (fail) await assert.rejects(work);
        else {
          const result = await work;
          assert.equal(
            result.state,
            nonInteractive ? "action_required" : "running",
          );
          if (nonInteractive)
            assert.partialDeepStrictEqual(result, {
              ready: false,
              action: "administrator_sign_in",
              complete: false,
            });
        }
        assert.deepEqual(
          calls,
          fail
            ? ["doctor", "apply"]
            : nonInteractive
              ? ["doctor", "apply", "start"]
              : ["doctor", "apply", "start", "login-expired", "login-complete"],
        );
        if (!fail && !nonInteractive) {
          assert.equal(links, 2);
          assert.ok(
            ui.notes.some((note) =>
              note.includes("/_clawscarf/login?setup=fixture"),
            ),
          );
          assert.ok(!ui.notes.some((note) => note.includes("One-use code:")));
        }
        assert.ok(
          !(
            await readFile(join(f.directory, "installation.json"), "utf8")
          ).includes("private-test-secret"),
        );
      }
  },
);

await test(
  "menu revisits sections without erasing unrelated answers or creating files",
  local,
  async (t) => {
    const f = await fixture(t);
    const ui = new Answers(
      {
        ...f.answers,
        "Installation name": "my-team",
        "Administrator display name": "Owner",
        "gateway CPUs": "4",
      },
      ["identity", "resources", "identity", "connections"],
    );
    const { config } = await collectInstallation(ui, f);
    assert.equal(config.name, "my-team");
    assert.equal(config.access.administratorName, "Owner");
    assert.equal(config.resources.runtime.cpu, "4");
    assert.equal(config.connections.mode, "disabled");
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
  },
);

await test(
  "Connections selection needs no provider credentials and retains its cloud destination when toggled",
  local,
  async (t) => {
    const f = await fixture(t);
    const ui = new Answers({ ...f.answers, "Enable Connections?": true }, [
      "connections",
    ]);
    const draft = await collectInstallation(ui, f);
    assert.equal(draft.config.connections.mode, "hosted");
    assert.equal(
      draft.config.connections.cloudUrl,
      "https://cloud.example.test",
    );
    assert.equal(draft.inputs.files.size, 0);
    assert.ok(
      !ui.questions.some((question) =>
        /Composio|broker key|catalog directory/i.test(question),
      ),
    );
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
    const toggled = await collectInstallation(
      new Answers({ ...f.answers, "Enable Connections?": false }, [
        "connections",
      ]),
      f,
      draft,
    );
    assert.deepEqual(toggled.config.connections, {
      ...draft.config.connections,
      mode: "disabled",
    });
  },
);

await test(
  "recipe defaults and explicit flags are shared by interactive and unattended configuration",
  local,
  async (t) => {
    const f = await fixture(t);
    const { loadRecipes } = await import("../tests/recipe-fixture.js");
    const { setupContext } = await import("./installation/setup.js");
    const { prepareConfiguration } =
      await import("./installation/configure.js");
    const { selectedDraft } = await import("./installation/options.js");
    const { SetupInputs } = await import("./installation/save.js");
    const { releaseSchema } = await import("./release/definition.js");
    const release = releaseSchema.parse(await readJson(f.release));
    await writeFile(
      f.release,
      JSON.stringify({
        ...release,
        recipes: await loadRecipes(resolve("deploy/recipes")),
      }),
    );
    const options = {
      ...f,
      recipe: "team-documents",
      name: "chosen-name",
      port: 19800,
      widgetPort: 19802,
    };
    const terminal = await collectInstallation(new Answers(f.answers), options);
    const unattended = await prepareConfiguration(options);
    assert.deepEqual(unattended.config, terminal.config);
    assert.equal(unattended.config.connections.mode, "hosted");
    assert.equal(unattended.config.name, "chosen-name");
    const context = await setupContext({
      release: f.release,
      cloudUrl: "https://staging.example.test",
    });
    for (const connections of [false, true]) {
      const inputs = new SetupInputs(f.directory);
      const draft = await selectedDraft(
        context,
        "team-documents",
        { connections },
        inputs,
      );
      const { gatewayRoutesSchema, nativeModelProvider } =
        await import("./models/configuration.js");
      assert.ok(draft.models);
      const routes = gatewayRoutesSchema.parse(
        await inputs.readJson(draft.models.configurationFile),
      );
      const native = nativeModelProvider({
        ...routes,
        mode: "litellm",
        baseUrl: "https://models.example.test/v1",
      });
      assert.equal(native.models[0]?.api, "openai-responses");
      assert.equal(draft.connections.mode, connections ? "hosted" : "disabled");
      assert.equal(draft.connections.cloudUrl, context.cloudUrl);
    }
    const draft = await prepareConfiguration({
      ...options,
      connections: false,
    });
    const path = await saveConfiguration(
      draft.directory,
      draft.config,
      draft.inputs,
    );
    assert.equal(
      installationSchema.parse(await readJson(path)).connections.mode,
      "disabled",
    );
    await assert.rejects(
      selectedDraft(context, "missing", {}, new SetupInputs(f.directory)),
      { code: "invalid_configuration" },
    );
    await assert.rejects(
      selectedDraft(
        context,
        "custom",
        { port: 19800, widgetPort: 19800 },
        new SetupInputs(f.directory),
      ),
      { code: "invalid_configuration" },
    );
  },
);

await test(
  "recipe packs are selected from the release and collect prerequisites after review",
  local,
  async (t) => {
    const f = await fixture(t);
    const { loadRecipes } = await import("../tests/recipe-fixture.js");
    const { releaseSchema } = await import("./release/definition.js");
    const { openPack } = await import("./packs/source.js");
    const source = await openPack(resolve("packs/research-team"));
    await cp(source.root, join(f.parent, "packs/research-team"), {
      recursive: true,
    });
    const recipes = await loadRecipes(resolve("deploy/recipes"));
    assert.ok(recipes[0]);
    recipes[0].packs = [{ id: "research-team", members: ["researcher"] }];
    const release = releaseSchema.parse(await readJson(f.release));
    await writeFile(
      f.release,
      JSON.stringify({
        ...release,
        recipes,
        packs: [{ id: "research-team", digest: source.digest }],
      }),
    );
    const ui = new Answers({
      ...f.answers,
      "Python executable with the pinned OpenShell SDK": join(f.parent, "tool"),
    });
    const draft = await collectInstallation(ui, {
      ...f,
      recipe: "team-documents",
    });
    assert.equal(
      draft.config.packs[0]?.directory,
      join(f.parent, "packs/research-team"),
    );
    assert.deepEqual(draft.config.packs[0].members, ["researcher"]);
    assert.equal(
      draft.config.packOperator?.pythonExecutable,
      join(f.parent, "tool"),
    );
    assert.ok(!ui.questions.includes("Pack directory"));
  },
);

await test("recipes refuse scripts, personal configuration, duplicate IDs and protection switches", async () => {
  const { loadRecipes } = await import("../tests/recipe-fixture.js");
  const { recipesSchema } =
    await import("./installation/recipes/definition.js");
  const [recipe] = await loadRecipes(resolve("deploy/recipes"));
  assert.ok(recipe);
  assert.equal(recipesSchema.safeParse([recipe, recipe]).success, false);
  for (const field of [
    { shell: "run" },
    { administrator: "someone" },
    { secrets: "key" },
  ])
    assert.equal(
      recipesSchema.safeParse([{ ...recipe, ...field }]).success,
      false,
    );
  assert.equal(
    recipesSchema.safeParse([
      { ...recipe, defaults: { ...recipe.defaults, openshell: false } },
    ]).success,
    false,
  );
});

await test(
  "masked provider keys use the same LiteLLM credential contract as imported files",
  local,
  async (t) => {
    const f = await fixture(t);
    const models = join(f.parent, "models.json");
    await writeFile(
      models,
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
    const ui = new Answers(
      {
        ...f.answers,
        "Default model": "team",
        Provider: "openai/test",
        "Model catalog file": models,
        "LLM API keys": "paste",
        "secret:OpenAI LLM API key": "private-$key#value",
      },
      ["advanced-models"],
    );
    const draft = await collectInstallation(ui, f);
    const path = await saveConfiguration(
      draft.directory,
      draft.config,
      draft.inputs,
    );
    const { loadGatewayConfiguration } =
      await import("./deployment/model-gateway.js");
    const loaded = await loadGatewayConfiguration(
      models,
      join(f.directory, "secrets/models.env"),
    );
    assert.equal(loaded.environment.PROVIDER_KEY, "private-$key#value");
    assert.ok(!ui.notes.join().includes("private-$key#value"));
    assert.ok(!(await readFile(path, "utf8")).includes("private-$key#value"));
  },
);

await test(
  "recipe reviews defaults before asking for missing credentials; CLI settings skip credential questions",
  local,
  async (t) => {
    const f = await fixture(t);
    const { loadRecipes } = await import("../tests/recipe-fixture.js");
    const { releaseSchema } = await import("./release/definition.js");
    const release = releaseSchema.parse(await readJson(f.release));
    await writeFile(
      f.release,
      JSON.stringify({
        ...release,
        recipes: await loadRecipes(resolve("deploy/recipes")),
      }),
    );
    const ui = new Answers(f.answers);
    const draft = await collectInstallation(ui, {
      release: f.release,
      directory: f.directory,
      recipe: "team-documents",
    });
    assert.ok(ui.questions.includes("secret:OpenAI LLM API key"));
    assert.ok(!ui.questions.includes("Model configuration file"));
    assert.ok(
      ui.questions.findIndex((question) =>
        question.endsWith("— configure installation"),
      ) < ui.questions.indexOf("secret:OpenAI LLM API key"),
    );
    assert.ok(!ui.questions.includes("Connections"));
    const file = await saveConfiguration(
      draft.directory,
      draft.config,
      draft.inputs,
    );
    const config = installationSchema.parse(await readJson(file));
    const modelConfig = await readJson(
      join(f.directory, config.models.configurationFile),
    );
    const { gatewayRoutesSchema, configurationSchema, nativeAssignments } =
      await import("./models/configuration.js");
    const routes = gatewayRoutesSchema.parse(modelConfig);
    assert.equal(routes.defaultModel, "gpt-6-astra");
    assert.deepEqual(routes.models[0]?.route, {
      model: "openai/gpt-6-astra",
      apiKeyEnv: "OPENAI_API_KEY",
    });
    assert.equal(routes.thinkingDefault, "medium");
    assert.ok(
      nativeAssignments(
        configurationSchema.parse({
          ...routes,
          mode: "litellm",
          baseUrl: "https://models.test/v1",
        }),
      ).some(
        (assignment) =>
          assignment.path === "agents.defaults.thinkingDefault" &&
          assignment.value === "medium",
      ),
    );
    assert.equal(
      installationSchema.parse(await readJson(file)).access.mode,
      "hosted",
    );
    assert.ok(!ui.questions.includes("Use your own OIDC provider?"));
    const supplied = new Answers(f.answers);
    await collectInstallation(supplied, {
      ...f,
      directory: join(f.parent, "supplied"),
      recipe: "team-documents",
    });
    assert.ok(
      !supplied.questions.some((question) => question.startsWith("secret:")),
    );
  },
);

await test(
  "Esc cancels a Connections section and preserves accepted settings",
  local,
  async (t) => {
    const f = await fixture(t);
    class CancelSection extends Answers {
      override async confirm(message: string) {
        if (message === "Enable Connections?") throw new SectionCancelled();
        return super.confirm(message);
      }
    }
    const ui = new CancelSection(
      {
        ...f.answers,
        "Installation name": "accepted-team",
      },
      ["identity", "connections"],
    );
    const draft = await collectInstallation(ui, f);
    assert.equal(draft.config.name, "accepted-team");
    assert.equal(
      ui.questions.filter((question) =>
        question.endsWith("— configure installation"),
      ).length,
      3,
    );
    assert.equal(draft.config.connections.mode, "disabled");
  },
);

await test(
  "noninteractive setup rejects absent or disabled Models before creating any files",
  local,
  async (t) => {
    const f = await fixture(t);
    const { prepareConfiguration } =
      await import("./installation/configure.js");
    await assert.rejects(
      prepareConfiguration({
        release: f.release,
        directory: f.directory,
        recipe: "custom",
      }),
      { code: "invalid_configuration" },
    );
    await assert.rejects(
      prepareConfiguration({
        release: f.release,
        directory: f.directory,
        recipe: "custom",
        model: "unknown-model",
      }),
    );
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
  },
);

await test(
  "advanced existing LiteLLM collects its URL and scoped key without upstream credentials",
  local,
  async (t) => {
    const f = await fixture(t);
    const ui = new Answers(
      {
        ...f.answers,
        "Model gateway": "external",
        "Model catalog file": join(f.parent, "initial-models.json"),
        "LiteLLM API URL (ending in /v1)": "https://models.example.test/v1",
        "Model gateway key": "paste",
        "secret:Model gateway key": "scoped-test-model-runtime-key",
      },
      ["advanced-models"],
    );
    const draft = await collectInstallation(ui, f);
    assert.equal(draft.config.models.mode, "external");
    assert.ok(!ui.questions.includes("Provider credentials"));
    const file = await saveConfiguration(
      draft.directory,
      draft.config,
      draft.inputs,
    );
    const saved = installationSchema.parse(await readJson(file));
    const { configurationSchema } = await import("./models/configuration.js");
    const catalog = configurationSchema.parse(
      await readJson(join(f.directory, saved.models.configurationFile)),
    );
    assert.equal(catalog.mode, "external");
    assert.equal(catalog.baseUrl, "https://models.example.test/v1");
    assert.equal(
      (await planInstallation(file)).capabilities.models,
      "external",
    );
  },
);

await test(
  "Esc at the first menu exits without creating files",
  local,
  async (t) => {
    const f = await fixture(t);
    class EscapeRoot extends Answers {
      override select(): Promise<string> {
        return Promise.reject(new SectionCancelled());
      }
    }
    await assert.rejects(
      collectInstallation(new EscapeRoot(f.answers), f),
      InstallerCancelled,
    );
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
  },
);

await test(
  "returning to settings retains accepted answers without prompting secrets again",
  local,
  async (t) => {
    const f = await fixture(t);
    const first = await collectInstallation(
      new Answers({ ...f.answers, "Installation name": "keep-final" }, [
        "identity",
      ]),
      f,
    );
    const ui = new Answers(f.answers);
    const second = await collectInstallation(ui, f, first);
    assert.equal(second.config.name, "keep-final");
    assert.ok(!ui.questions.some((question) => question.startsWith("secret:")));
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
  },
);

await test(
  "changing the default model replaces the recipe provider and asks only for the selected provider key",
  local,
  async (t) => {
    const f = await fixture(t);
    const { releaseSchema } = await import("./release/definition.js");
    const { gatewayRoutesSchema } = await import("./models/configuration.js");
    const release = releaseSchema.parse(await readJson(f.release));
    const model = gatewayRoutesSchema.parse(
      await readJson(join(f.parent, "initial-models.json")),
    ).models[0];
    assert.ok(model);
    await writeFile(
      f.release,
      JSON.stringify({
        ...release,
        modelCatalog: [
          {
            provider: "Anthropic",
            model: {
              ...model,
              id: "selected",
              name: "Selected",
              reasoning: true,
              route: {
                model: "anthropic/selected",
                apiKeyEnv: "ANTHROPIC_API_KEY",
              },
            },
            reasoningLevels: ["high"],
          },
        ],
      }),
    );
    const ui = new Answers(
      {
        ...f.answers,
        "Default model": "selected",
        Provider: "anthropic/selected",
        "secret:Anthropic LLM API key": "selected-secret",
      },
      ["models"],
    );
    const draft = await collectInstallation(ui, f);
    assert.equal(draft.config.models.mode, "litellm");
    const staged = draft.inputs.files.get(
      draft.config.models.configurationFile,
    );
    assert.ok(staged);
    const routes = gatewayRoutesSchema.parse(
      JSON.parse(staged.toString("utf8")),
    );
    assert.deepEqual(
      routes.models.map((entry) => entry.id),
      ["selected"],
    );
    assert.equal(routes.thinkingDefault, "high");
    assert.ok(ui.questions.includes("secret:Anthropic LLM API key"));
    assert.ok(!ui.questions.includes("secret:OpenAI LLM API key"));
  },
);

await test(
  "programming errors escape the installer instead of becoming a repeated input question",
  local,
  async (t) => {
    const f = await fixture(t);
    const failure = new TypeError("fixture programming error");
    class BrokenPrompt extends Answers {
      override confirm(message: string, initial?: boolean): Promise<boolean> {
        if (message === "Enable Connections?") return Promise.reject(failure);
        return super.confirm(message, initial);
      }
    }
    await assert.rejects(
      collectInstallation(new BrokenPrompt(f.answers, ["connections"]), f),
      (error) => error === failure,
    );
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
  },
);

await test(
  "revisiting OIDC settings retains explicit bootstrap identity and collects TLS secrets only after acceptance",
  local,
  async (t) => {
    const f = await fixture(t);
    const key = join(f.parent, "key");
    await writeFile(key, "private-test-secret", { mode: 0o600 });
    const values = {
      ...f.answers,
      "Use your own OIDC provider?": true,
      "Make this server available over HTTPS?": true,
      "Application HTTPS origin": "https://team.example.test:8443",
      "Widgets HTTPS origin": "https://widgets.example.test:8445",
      "TLS certificate file": key,
      "TLS private key file": key,
      "OIDC issuer": "https://identity.example.test",
      "OIDC client ID": "team",
      "OIDC client secret": "file",
      "OIDC client secret file": key,
    };
    const ui = new Answers(values, ["exposure", "access"]);
    const first = await collectInstallation(ui, f);
    assert.ok(
      ui.questions.indexOf("Save section changes?") <
        ui.questions.indexOf("TLS private key file"),
    );
    assert.equal(first.config.access.mode, "oidc");
    first.config.access.administratorSubject = "provided-subject";
    first.config.access.administratorEmail = "owner@example.test";
    const second = await collectInstallation(
      new Answers(values, ["exposure", "access"]),
      f,
      first,
    );
    assert.equal(second.config.access.mode, "oidc");
    assert.equal(second.config.access.administratorSubject, "provided-subject");
    assert.equal(second.config.access.administratorEmail, "owner@example.test");
  },
);

await test(
  "changing the external model gateway does not reuse the previous gateway credential",
  local,
  async (t) => {
    const f = await fixture(t);
    const first = await collectInstallation(
      new Answers(
        {
          ...f.answers,
          "Model gateway": "external",
          "LiteLLM API URL (ending in /v1)": "https://first.example.test/v1",
          "Model gateway key": "paste",
          "secret:Model gateway key": "first-gateway-secret",
        },
        ["advanced-models"],
      ),
      f,
    );
    const ui = new Answers(
      {
        ...f.answers,
        "Model gateway": "external",
        "LiteLLM API URL (ending in /v1)": "https://second.example.test/v1",
        "Model gateway key": "paste",
        "secret:Model gateway key": "second-gateway-secret",
      },
      ["advanced-models"],
    );
    const second = await collectInstallation(ui, f, first);
    assert.equal(second.config.models.mode, "external");
    assert.ok(ui.questions.includes("secret:Model gateway key"));
    assert.equal(
      second.inputs.files
        .get(second.config.models.credentialFile)
        ?.toString("utf8"),
      "second-gateway-secret",
    );
  },
);

await test("cancelling read-only progress aborts polling promptly", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { setTimeout as delay } from 'node:timers/promises';
    import { progress, InstallerCancelled } from './scripts/installation/installer/prompts.ts';
    const started = Date.now();
    await assert.rejects(progress('Waiting for sign-in', async signal => {
      process.emit('SIGINT');
      signal.throwIfAborted();
      await delay(60_000, undefined, {signal});
    }), InstallerCancelled);
    assert.ok(Date.now() - started < 1000);
    console.log('Read-only wait cancelled');
  `,
    ],
    { timeout: 5000 },
  );
  assert.match(stdout, /Read-only wait cancelled/);
});

await test(
  "retained settings discard a changed key on Esc and preserve accepted inputs",
  local,
  async (t) => {
    const f = await fixture(t);
    const first = await collectInstallation(new Answers(f.answers), f);
    const original = structuredClone(first.config);
    const inputs = new Map(first.inputs.files);
    class DiscardKey extends Answers {
      override confirm(message: string): Promise<boolean> {
        if (message === "Save section changes?")
          return Promise.reject(new SectionCancelled());
        return super.confirm(message);
      }
      override select(message: string, choices: Choice[], initial?: string) {
        if (message.endsWith("— settings"))
          assert.deepEqual(
            choices.map((choice) => choice.value),
            ["review", "models", "connections", "packs", "model-credentials"],
          );
        return super.select(message, choices, initial);
      }
    }
    const result = await collectInstallation(
      new DiscardKey(
        { ...f.answers, "secret:OpenAI LLM API key": "discard-me" },
        ["model-credentials"],
      ),
      { release: f.release, existing: true },
      first,
    );
    assert.deepEqual(result.config, original);
    assert.deepEqual(result.inputs.files, inputs);
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
  },
);

await test(
  "retained settings main-menu Esc exits without creating drafts or stopping the installation",
  local,
  async (t) => {
    const f = await fixture(t);
    const first = await collectInstallation(new Answers(f.answers), f);
    const state = join(f.parent, "state");
    await mkdir(state, { mode: 0o700 });
    const accepted = JSON.stringify({ ...first.config, stateDirectory: state });
    await writeFile(join(state, "settings.json"), accepted, { mode: 0o600 });
    await writeFile(
      join(state, "prepared.json"),
      JSON.stringify({ ownerId: "test" }),
    );
    class Exit extends Answers {
      override select(
        message: string,
        choices: Choice[],
        initial?: string,
      ): Promise<string> {
        if (message.endsWith("— settings"))
          return Promise.reject(new SectionCancelled());
        return super.select(message, choices, initial);
      }
    }
    const { editInstallationSettings } =
      await import("./installation/installer/settings.js");
    await assert.rejects(
      editInstallationSettings(state, new Exit(f.answers)),
      InstallerCancelled,
    );
    assert.equal(
      await readFile(join(state, "settings.json"), "utf8"),
      accepted,
    );
    assert.deepEqual(await readdir(state), ["prepared.json", "settings.json"]);
  },
);

await test(
  "retained default changes preserve previously configured model routes for native overrides",
  local,
  async (t) => {
    const f = await fixture(t);
    const first = await collectInstallation(new Answers(f.answers), f);
    const { releaseSchema } = await import("./release/definition.js");
    const { gatewayRoutesSchema } = await import("./models/configuration.js");
    const release = releaseSchema.parse(await readJson(f.release));
    const routes = gatewayRoutesSchema.parse(
      await readJson(first.config.models.configurationFile),
    );
    const model = routes.models[0];
    assert.ok(model);
    await writeFile(
      f.release,
      JSON.stringify({
        ...release,
        modelCatalog: [
          {
            provider: "OpenAI",
            model: { ...model, id: "second", name: "Second" },
            reasoningLevels: [],
          },
        ],
      }),
    );
    const result = await collectInstallation(
      new Answers({ ...f.answers, "Default model": "second" }, ["models"]),
      { release: f.release, existing: true },
      first,
    );
    const changed = gatewayRoutesSchema.parse(
      await result.inputs.readJson(result.config.models.configurationFile),
    );
    assert.deepEqual(
      changed.models.map((model) => model.id),
      ["team", "second"],
    );
    assert.equal(changed.defaultModel, "second");
    const saved = await saveConfiguration(
      f.directory,
      result.config,
      result.inputs,
      true,
    );
    assert.ok(saved);
    assert.deepEqual(
      gatewayRoutesSchema.parse(
        await readJson(join(f.directory, "models.json")),
      ),
      changed,
    );
  },
);

await test(
  "unattended hosted setup uses the same registration and plans a real OIDC installation",
  local,
  async (t) => {
    const { default: Fastify } = await import("fastify");
    const { randomUUID } = await import("node:crypto");
    const { prepareConfiguration } =
      await import("./installation/configure.js");
    const { resolveInstallation } = await import("./installation/resolve.js");
    const f = await fixture(t);
    const app = Fastify();
    t.after(() => app.close());
    const id = randomUUID();
    const credential = join(f.parent, "cloud-credential");
    await writeFile(credential, "owner-token", { mode: 0o600 });
    app.get("/api/account", () => ({
      accountId: randomUUID(),
      identity: {
        issuer: "https://identity.example",
        subject: "owner",
        email: "owner@example.com",
      },
    }));
    app.post("/api/installations", (request) => {
      assert.equal(request.headers.authorization, "Bearer owner-token");
      return { id, origin: "http://127.0.0.1:18800", oidcState: "ready" };
    });
    app.get("/api/installations/:id/identity", () => ({
      issuer: "https://identity.example",
      clientId: "registered-client",
      clientSecret: "private-client-secret",
    }));
    const cloudUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    const draft = await prepareConfiguration({
      release: f.release,
      directory: f.directory,
      modelCatalog: f.modelCatalog,
      providerEnvFile: f.providerEnvFile,
      recipe: "custom",
      cloudUrl,
    });
    const configFile = await saveConfiguration(
      draft.directory,
      draft.config,
      draft.inputs,
    );
    const { registerUnattended } =
      await import("./installation/installer/cloud.js");
    await registerUnattended(configFile, credential);
    const plan = await planInstallation(configFile);
    const resolved = await resolveInstallation(configFile, plan.internalPorts);
    assert.equal(resolved.config.access.mode, "hosted");
    assert.equal(resolved.input.team.clientId, "registered-client");
    assert.equal(resolved.input.team.administratorSubject, "owner");
    await app.close();
    await registerUnattended(configFile, undefined);
  },
);

await test(
  "configuration flags reject unsafe combinations and preserve accepted model routes",
  local,
  async (t) => {
    const f = await fixture(t);
    const { setupContext } = await import("./installation/setup.js");
    const { selectedDraft } = await import("./installation/options.js");
    const { SetupInputs } = await import("./installation/save.js");
    const { gatewayRoutesSchema } = await import("./models/configuration.js");
    const context = await setupContext(f);
    const first = await selectedDraft(
      context,
      "custom",
      f,
      new SetupInputs(f.directory),
    );
    const key = join(f.parent, "new-key");
    await writeFile(key, "rotated-key", { mode: 0o600 });
    const inputs = new SetupInputs(f.directory);
    const updated = await selectedDraft(
      context,
      "custom",
      { model: "team", provider: "openai", llmKeyFile: key },
      inputs,
      first,
    );
    assert.equal(updated.models?.mode, "litellm");
    assert.ok(updated.models);
    const routes = gatewayRoutesSchema.parse(
      await inputs.readJson(updated.models.configurationFile),
    );
    assert.equal(routes.defaultModel, "team");
    assert.ok(!JSON.stringify(updated).includes("rotated-key"));
    for (const options of [
      { reasoning: "high" as const },
      { provider: "unknown" },
      { name: "changed" },
      { oidcIssuer: "https://other.example" },
      { llmKeyFile: key, providerEnvFile: f.providerEnvFile },
    ])
      await assert.rejects(
        selectedDraft(
          context,
          "custom",
          options,
          new SetupInputs(f.directory),
          first,
        ),
        { code: "invalid_configuration" },
      );
    await assert.rejects(
      selectedDraft(
        context,
        "custom",
        { access: "hosted", oidcIssuer: f.oidcIssuer },
        inputs,
      ),
      { code: "invalid_configuration" },
    );
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
  },
);

await test(
  "interrupted cloud authorization retains an accepted settings candidate without stopping the server",
  local,
  async (t) => {
    const { default: Fastify } = await import("fastify");
    const { editInstallationSettings } =
      await import("./installation/installer/settings.js");
    const { resolveConfigurationInputs } =
      await import("./installation/configure.js");
    const { unattendedPrompts } =
      await import("./installation/installer/prompts.js");
    const f = await fixture(t);
    const first = await collectInstallation(new Answers(f.answers), f);
    const configFile = await saveConfiguration(
      first.directory,
      first.config,
      first.inputs,
    );
    const state = join(f.directory, "state");
    await mkdir(state, { mode: 0o700 });
    const config = resolveConfigurationInputs(
      installationSchema.parse(await readJson(configFile)),
      first.directory,
    );
    const accepted = JSON.stringify({ ...config, stateDirectory: state });
    await writeFile(join(state, "settings.json"), accepted, { mode: 0o600 });
    await writeFile(
      join(state, "prepared.json"),
      JSON.stringify({ ownerId: "test" }),
    );
    const app = Fastify();
    t.after(() => app.close());
    app.get("/api/identity", (_request, reply) =>
      reply.code(503).send({ error: "unavailable" }),
    );
    const cloudUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    await assert.rejects(
      () =>
        editInstallationSettings(state, unattendedPrompts, {
          nonInteractive: true,
          yes: true,
          connections: true,
          connectionsCloudUrl: cloudUrl,
        }),
      { code: "unavailable" },
    );
    const before = await readJson(join(state, "prepared.json"));
    assert.equal(
      await readFile(join(state, "settings.json"), "utf8"),
      accepted,
    );
    await assert.rejects(
      () =>
        editInstallationSettings(state, unattendedPrompts, {
          nonInteractive: true,
          yes: true,
        }),
      { code: "unavailable" },
    );
    assert.deepEqual(await readJson(join(state, "prepared.json")), before);
    assert.equal(
      (await readdir(state)).filter((name) => name.startsWith(".settings-"))
        .length,
      1,
    );
  },
);
