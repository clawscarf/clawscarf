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
  confirm(message: string) {
    this.questions.push(message);
    const value = this.values[message] ?? message === "Save section changes?";
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
      recipes: [],
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
  const settings = join(parent, "initial-settings.json");
  await writeFile(
    settings,
    JSON.stringify({
      models: {
        mode: "litellm",
        configurationFile: models,
        upstreamEnvironmentFile: env,
      },
    }),
  );
  const answers = {
    "Starting point": "custom",
    Access: "local",
    "Default model": "team",
    Provider: "openai/test",
    "Model catalog": "file",
    "Model catalog file": models,
    "secret:OpenAI LLM API key": "test-key",
    "secret:OpenRouter LLM API key": "test-key",
    Connections: "off",
    "Start now?": false,
    [`Install in ${directory}?`]: true,
  };
  return { parent, release, directory, settings, answers };
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
        Access: "oidc",
        "Application HTTPS origin": "https://team.example.test:8443",
        "Widgets HTTPS origin (separate listener port)":
          "https://widgets.example.test:8445",
        "TLS certificate file": key,
        "TLS private key file": key,
        "OIDC issuer": "https://identity.example.test",
        "OIDC client ID": "team",
        "OIDC client secret": "file",
        "OIDC client secret file": key,
      },
      ["access"],
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
        Connections: "on",
        "Connections backend": "external",
        "Model catalog file": modelFile,
        "LLM API keys": "file",
        "Provider credentials file (.env)": key,
        "Connections broker URL": "https://broker.example.test",
        "Connections broker key": "file",
        "Connections broker key file": key,
        "Install a pack? (experimental native Claws)": true,
        "Pack directory": resolve("packs/research-team"),
        "Pack agents": ["researcher", "reviewer"],
        "Python executable with the pinned OpenShell SDK": "/usr/bin/python3",
      },
      ["advanced-models", "connections", "packs"],
    );
    const result = await savePreview(f, ui);
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
      const ui = new Answers({ ...f.answers, "Start now?": true });
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
          return Promise.resolve({
            supervisor: "running" as const,
            ready: true,
            packs: [],
            administrator: "ready" as const,
          });
        },
        administrator: () =>
          Promise.resolve({ complete: true, expiresAt: null }),
        login: () =>
          Promise.resolve({
            url: "http://127.0.0.1:18800/_clawscarf/local-sign-in",
            code: "one-use-fixture",
          }),
      });
      if (fail) await assert.rejects(work);
      else assert.equal((await work).state, "running");
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
    assert.equal(config.resources.gateway.cpu, "4");
    assert.deepEqual(config.connections, { mode: "disabled" });
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
  },
);

await test(
  "masked secrets stay unsaved until acceptance and never enter configuration or notes",
  local,
  async (t) => {
    const f = await fixture(t);
    const ui = new Answers(
      {
        ...f.answers,
        Connections: "on",
        "Connections backend": "external",
        "Connections broker URL": "https://broker.example.test",
        "Connections broker key": "paste",
        "secret:Connections broker key": "masked-test-secret",
      },
      ["connections"],
    );
    const draft = await collectInstallation(ui, f);
    assert.equal(draft.inputs.files.size, 1);
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
    assert.ok(!JSON.stringify(draft.config).includes("masked-test-secret"));
    assert.ok(!ui.notes.join().includes("masked-test-secret"));
    const file = await saveConfiguration(
      draft.directory,
      draft.config,
      draft.inputs,
    );
    assert.ok(!(await readFile(file, "utf8")).includes("masked-test-secret"));
    assert.equal(
      await readFile(join(f.directory, "secrets/broker-key"), "utf8"),
      "masked-test-secret",
    );
    assert.equal(
      (await lstat(join(f.directory, "secrets/broker-key"))).mode & 0o777,
      0o600,
    );
  },
);

await test(
  "disabling Connections discards entered credentials from the saved installation",
  local,
  async (t) => {
    const f = await fixture(t);
    class DisableConnections extends Answers {
      private visits = 0;
      override select(message: string, choices: Choice[], initial?: string) {
        if (message === "Connections")
          return Promise.resolve(this.visits++ ? "off" : "on");
        return super.select(message, choices, initial);
      }
    }
    const ui = new DisableConnections(
      {
        ...f.answers,
        Connections: "on",
        "Connections backend": "external",
        "Connections broker URL": "https://broker.example.test",
        "Connections broker key": "paste",
        "secret:Connections broker key": "unused-secret",
      },
      ["connections", "connections"],
    );
    const draft = await collectInstallation(ui, f);
    assert.deepEqual(draft.config.connections, { mode: "disabled" });
    await saveConfiguration(draft.directory, draft.config, draft.inputs);
    await assert.rejects(lstat(join(f.directory, "secrets/broker-key")), {
      code: "ENOENT",
    });
  },
);

await test(
  "recipe configuration is shared by terminal and CLI; settings replace entire sections",
  local,
  async (t) => {
    const f = await fixture(t);
    const { loadRecipes } = await import("./installation/recipes/load.js");
    const { setupContext, configureRecipe } =
      await import("./installation/setup.js");
    const { configureInstallation } =
      await import("./installation/configure.js");
    const recipes = await loadRecipes(resolve("deploy/recipes"));
    const { releaseSchema } = await import("./release/definition.js");
    const release = releaseSchema.parse(await readJson(f.release));
    await writeFile(f.release, JSON.stringify({ ...release, recipes }));
    const draft = await collectInstallation(new Answers(f.answers), {
      ...f,
      recipe: "team-documents",
    });
    const context = await setupContext({ release: f.release });
    assert.deepEqual(
      configureRecipe(context, "team-documents", await readJson(f.settings)),
      draft.config,
    );
    assert.equal(draft.config.recipe?.id, "team-documents");
    assert.equal(draft.config.connections.mode, "disabled");
    const key = join(f.parent, "key");
    await writeFile(key, "cli-private-key", { mode: 0o600 });
    const settings = join(f.parent, "settings.json");
    await writeFile(
      settings,
      JSON.stringify({
        models: {
          mode: "litellm",
          upstreamEnvironmentFile: "initial-models.env",
        },
        name: "configured-team",
        connections: {
          mode: "external",
          brokerUrl: "https://broker.example.test",
          credentialFile: "key",
        },
      }),
    );
    const result = await configureInstallation({
      ...f,
      recipe: "team-documents",
      settings,
    });
    const saved = installationSchema.parse(await readJson(result.configFile));
    assert.equal(saved.name, "configured-team");
    assert.equal(
      await readFile(join(f.directory, "secrets/broker-key"), "utf8"),
      "cli-private-key",
    );
    assert.throws(() => configureRecipe(context, "missing", {}), {
      code: "invalid_configuration",
    });
    assert.throws(() =>
      configureRecipe(context, "custom", {
        connections: { mode: "disabled", apiKeyFile: "obsolete" },
      }),
    );
    assert.throws(() =>
      configureRecipe(context, "custom", {
        models: draft.config.models,
        browser: { enabled: true },
      }),
    );
    assert.throws(() =>
      configureRecipe(context, "custom", {
        resources: { worker: { cpu: "2", memory: "2Gi" } },
      }),
    );
  },
);

await test(
  "recipe packs are selected from the release and collect prerequisites after review",
  local,
  async (t) => {
    const f = await fixture(t);
    const { loadRecipes } = await import("./installation/recipes/load.js");
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
  const { loadRecipes } = await import("./installation/recipes/load.js");
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
      await import("./local/model-gateway.js");
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
    const { loadRecipes } = await import("./installation/recipes/load.js");
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
    assert.ok(ui.questions.includes("secret:OpenRouter LLM API key"));
    assert.ok(!ui.questions.includes("Model configuration file"));
    assert.ok(
      ui.questions.findIndex((question) =>
        question.endsWith("— configure installation"),
      ) < ui.questions.indexOf("secret:OpenRouter LLM API key"),
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
    assert.equal((await planInstallation(file)).capabilities.models, "litellm");
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
  "Esc cancels a section atomically, drops new secrets and preserves accepted settings",
  local,
  async (t) => {
    const f = await fixture(t);
    class CancelSection extends Answers {
      override async confirm(message: string) {
        if (message === "Use a custom certificate authority?")
          throw new SectionCancelled();
        return super.confirm(message);
      }
    }
    const ui = new CancelSection(
      {
        ...f.answers,
        Connections: "on",
        "Connections backend": "external",
        "Connections broker URL": "https://broker.example.test",
        "Connections broker key": "paste",
        "secret:Connections broker key": "discard-me",
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
    assert.deepEqual(draft.config.connections, { mode: "disabled" });
    assert.ok(
      ![...draft.inputs.files.values()].some((value) =>
        value.includes("discard-me"),
      ),
    );
  },
);

await test(
  "noninteractive setup rejects absent or disabled Models before creating any files",
  local,
  async (t) => {
    const f = await fixture(t);
    const { configureInstallation } =
      await import("./installation/configure.js");
    await assert.rejects(
      configureInstallation({
        release: f.release,
        directory: f.directory,
        recipe: "custom",
      }),
      { code: "invalid_configuration" },
    );
    const settings = join(f.parent, "disabled.json");
    await writeFile(settings, JSON.stringify({ models: { mode: "disabled" } }));
    await assert.rejects(
      configureInstallation({
        release: f.release,
        directory: f.directory,
        recipe: "custom",
        settings,
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
      override select(
        message: string,
        choices: Choice[],
        initial?: string,
      ): Promise<string> {
        if (message === "Connections") return Promise.reject(failure);
        return super.select(message, choices, initial);
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
      Access: "oidc",
      "Application HTTPS origin": "https://team.example.test:8443",
      "Widgets HTTPS origin (separate listener port)":
        "https://widgets.example.test:8445",
      "TLS certificate file": key,
      "TLS private key file": key,
      "OIDC issuer": "https://identity.example.test",
      "OIDC client ID": "team",
      "OIDC client secret": "file",
      "OIDC client secret file": key,
    };
    const ui = new Answers(values, ["access"]);
    const first = await collectInstallation(ui, f);
    assert.ok(
      ui.questions.indexOf("Save section changes?") <
        ui.questions.indexOf("TLS private key file"),
    );
    assert.equal(first.config.access.mode, "oidc");
    first.config.access.administratorSubject = "provided-subject";
    first.config.access.administratorEmail = "owner@example.test";
    const second = await collectInstallation(
      new Answers(values, ["access"]),
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
    assert.deepEqual(await readdir(state), ["settings.json"]);
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
