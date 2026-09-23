import { releaseSchema } from "./release/definition.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, type TestContext } from "node:test";
import {
  chmod,
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
import { join, resolve, dirname } from "node:path";
import { collectInstallation } from "./installation/installer/collect.js";
import { saveConfiguration } from "./installation/save.js";
import {
  InstallerCancelled,
  SectionCancelled,
  type InstallerPrompts,
  type Choice,
} from "./installation/installer/prompts.js";
import {
  installFromAnswers,
  runConfiguration,
} from "./installation/installer/run.js";
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
  opened: string[] = [];
  openBrowser(url: string) {
    this.opened.push(url);
    return Promise.resolve();
  }
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
      sourceRevision: "a".repeat(40),
      platforms: ["darwin-arm64"],
      images: {
        postgres: postgresImage,
        models: liteLlmImage,
        gateway: image,
        companion: image,
        openshellClient: image,
      },
      tools: {
        openshell: {
          version: "0.0.116",
          cli: { "darwin-arm64": tool },
          gateway: { "darwin-arm64": tool },
        },
      },
    }),
  );
  const recipe = join(parent, "recipe.json");
  const { readRecipe } = await import("./installation/recipes/catalog.js");
  const preset = await readRecipe(resolve("recipes/team-server/recipe.json"));
  await writeFile(
    recipe,
    JSON.stringify({
      ...preset,
      runtime: release,
      defaults: { ...preset.defaults, connections: { enabled: false } },
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
    "Starting point": "team-server",
    Access: "local",
    "Default model": "team",
    Provider: "openai/test",
    "Model catalog": "file",
    "Model catalog file": models,
    "secret:OpenAI API key": "test-key",
    Connections: "off",
    "Start now?": false,
    [`Install in ${directory}?`]: true,
  };
  return {
    parent,
    release,
    recipe,
    directory,
    answers,
    cloudUrl: "https://cloud.example.test",
    oidcIssuer: "https://issuer.example.test",
    oidcClientId: "fixture",
    oidcSecretFile: env,
    modelCatalog: models,
    providerEnvFile: env,
  };
}
async function saveAnswers(
  options: Parameters<typeof collectInstallation>[1],
  ui: InstallerPrompts,
) {
  const draft = await collectInstallation(ui, options);
  const configFile = await saveConfiguration(
    draft.directory,
    draft.config,
    draft.inputs,
  );
  return { state: "saved", configFile };
}
const local = {
  skip: process.platform !== "darwin" || process.arch !== "arm64",
};

await test(
  "collected settings save private files without applying",
  local,
  async (t) => {
    const f = await fixture(t);
    const ui = new Answers(f.answers);
    const result = await saveAnswers(f, ui);
    assert.equal(result.state, "saved");
    const config = installationSchema.parse(
      await readJson(join(f.directory, "installation.json")),
    );
    assert.equal(config.models.mode, "litellm");
    assert.equal(config.connections.mode, "disabled");
    assert.ok(config.resources.runtime);
    assert.deepEqual(config.packs, []);
    for (const [path, mode] of [
      [f.directory, 0o700],
      [join(f.directory, "installation.json"), 0o600],
    ] as const)
      assert.equal((await lstat(path)).mode & 0o777, mode);
    await assert.rejects(lstat(join(f.directory, "state")), { code: "ENOENT" });
    assert.ok(!ui.questions.some((question) => question.includes("key file")));
    const before = await readFile(join(f.directory, "installation.json"));
    await assert.rejects(saveAnswers(f, new Answers(f.answers)), {
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
    assert.deepEqual(
      await installFromAnswers(f, ui, {
        host: () => Promise.resolve(),
        ports: () => Promise.resolve(),
        prerequisites: () => {
          throw Error("Unexpected prerequisite acquisition");
        },
        plan: planInstallation,
        apply: () => {
          throw Error("Unexpected apply");
        },
        start: () => {
          throw Error("Unexpected start");
        },
        administrator: () => {
          throw Error("Unexpected administrator setup");
        },
        register: () => {
          throw Error("Unexpected registration");
        },
      }),
      { state: "cancelled" },
    );
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
    const modelFile = join(f.parent, "models.json");
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
    const ui = new Answers(
      {
        ...f.answers,
        "Default model": "team",
        Provider: "openai/test",
        "Model catalog file": modelFile,
        "secret:OpenAI API key": "private-test-secret",
        "Install a pack? (experimental native Claws)": true,
        Pack: resolve("packs/research-team"),
        "Pack agents": ["researcher", "reviewer"],
        "Python executable with the pinned OpenShell SDK": "/usr/bin/python3",
      },
      ["advanced-models", "packs"],
    );
    const result = await saveAnswers(f, ui);
    assert.equal(result.state, "saved");
    const configFile = join(f.directory, "installation.json");
    const plan = await planInstallation(configFile);
    assert.ok(!JSON.stringify(plan).includes("private-test-secret"));
    await writeFile(
      join(f.directory, "secrets/models.env"),
      "PROVIDER_KEY=changed\n",
    );
    await assert.rejects(applyInstallation(configFile, plan), {
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
      for (const fail of [false, true, "cancel", "pack"] as const) {
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
          nonInteractive ? { ...f, recipe: f.recipe, nonInteractive: true } : f,
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
            host: () => {
              calls.push("host");
              return Promise.resolve();
            },
            ports: () => {
              calls.push("ports");
              return Promise.resolve();
            },
            prerequisites: () => {
              calls.push("prerequisites");
              return Promise.resolve({
                state: "prerequisites_available",
                platform: "darwin-arm64",
                release: "0.1.0-dev",
                images: 5,
              });
            },
            apply: (config, plan) => {
              calls.push("apply");
              assert.equal(config, join(f.directory, "installation.json"));
              assert.equal(plan.stateDirectory, join(f.directory, "state"));
              if (fail === "cancel")
                return Promise.reject(new InstallerCancelled());
              if (fail === true)
                return Promise.reject(Error("Fixture failure"));
              return Promise.resolve({
                state: "prepared",
                directory: f.directory,
                release: "0.1.0-dev",
              });
            },
            start: (state) => {
              calls.push("start");
              assert.equal(state, join(f.directory, "state"));
              return Promise.resolve({
                state: "running" as const,
                ready: true,
                packs:
                  fail === "pack"
                    ? [{ member: "example", state: "blocked" as const }]
                    : [],
                administrator: "ready" as const,
                services: [],
              });
            },
            register: () => {
              calls.push("register");
              return Promise.resolve();
            },
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
        if (fail === true || fail === "cancel") await assert.rejects(work);
        else {
          const result = await work;
          assert.equal(
            result.state,
            nonInteractive ? "action_required" : "running",
          );
          if (!nonInteractive && "ready" in result)
            assert.equal(result.ready, fail !== "pack");
          if (nonInteractive)
            assert.partialDeepStrictEqual(result, {
              ready: false,
              action: "administrator_sign_in",
              complete: false,
            });
        }
        assert.deepEqual(
          calls,
          fail === true || fail === "cancel"
            ? ["host", "ports", "prerequisites", "register", "apply"]
            : nonInteractive
              ? ["host", "ports", "prerequisites", "register", "apply", "start"]
              : [
                  "host",
                  "ports",
                  "prerequisites",
                  "register",
                  "apply",
                  "start",
                  "login-expired",
                  "login-complete",
                ],
        );
        if (nonInteractive) assert.deepEqual(ui.opened, []);
        if (!fail && !nonInteractive) {
          assert.equal(links, 2);
          assert.equal(ui.opened.length, 2);
          assert.ok(ui.opened.every((url) => url.endsWith("setup=fixture")));
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
        "Default agent name": "Atlas",
        "Administrator display name": "Owner",
        "gateway CPUs": "4",
      },
      ["identity", "resources", "identity", "connections"],
    );
    const { config } = await collectInstallation(ui, f);
    assert.equal(config.name, "my-team");
    assert.equal(config.agentName, "Atlas");
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
    assert.deepEqual(
      [...draft.inputs.files.keys()].map((file) => file.split("/").at(-1)),
      ["recipe-models.json"],
    );
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
    const { readRecipe } = await import("./installation/recipes/catalog.js");
    const { setupContext } = await import("./installation/setup.js");
    const { prepareConfiguration } =
      await import("./installation/configure.js");
    const { selectedDraft } = await import("./installation/options.js");
    const { SetupInputs } = await import("./installation/save.js");
    const [preset] = [
      await readRecipe(resolve("recipes/team-server/recipe.json")),
    ];
    await writeFile(
      f.recipe,
      JSON.stringify({ ...preset, runtime: f.release }),
    );
    const options = {
      ...f,
      recipe: f.recipe,
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
      recipe: f.recipe,
      cloudUrl: "https://staging.example.test",
    });
    for (const connections of [false, true]) {
      const inputs = new SetupInputs(f.directory);
      const draft = await selectedDraft(
        context,
        "team-server",
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
        "team-server",
        { port: 19800, widgetPort: 19800 },
        new SetupInputs(f.directory),
      ),
      { code: "invalid_configuration" },
    );
  },
);

await test(
  "recipe packs are selected from the CLI catalog and collect prerequisites after review",
  local,
  async (t) => {
    const f = await fixture(t);
    const { readRecipe } = await import("./installation/recipes/catalog.js");
    const recipes = [
      await readRecipe(resolve("recipes/team-server/recipe.json")),
    ];
    assert.ok(recipes[0]);
    await writeFile(
      f.recipe,
      JSON.stringify({
        ...recipes[0],
        runtime: f.release,
        packs: [{ id: "research-team", members: ["researcher"] }],
      }),
    );
    const ui = new Answers({
      ...f.answers,
      "Python executable with the pinned OpenShell SDK": join(f.parent, "tool"),
    });
    const draft = await collectInstallation(ui, {
      ...f,
      recipe: f.recipe,
    });
    assert.equal(
      draft.config.packs[0]?.directory,
      resolve("packs/research-team"),
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
  const { readRecipe } = await import("./installation/recipes/catalog.js");
  const { recipesSchema } =
    await import("./installation/recipes/definition.js");
  const [recipe] = [
    await readRecipe(resolve("recipes/team-server/recipe.json")),
  ];
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
        "secret:OpenAI API key": "private-$key#value",
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
  "Cloud recipe reviews prepaid services without asking for provider credentials",
  local,
  async (t) => {
    const f = await fixture(t);
    const { readRecipe } = await import("./installation/recipes/catalog.js");
    const [preset] = [
      await readRecipe(resolve("recipes/team-server/recipe.json")),
    ];
    await writeFile(
      f.recipe,
      JSON.stringify({ ...preset, runtime: f.release }),
    );
    await writeFile(
      f.release,
      JSON.stringify({
        ...releaseSchema.parse(await readJson(f.release)),
        cloudBilling: true,
      }),
    );
    const ui = new Answers(f.answers);
    const draft = await collectInstallation(ui, {
      recipe: f.recipe,
      directory: f.directory,
    });
    assert.equal(draft.config.agentName, preset.defaults.agentName);
    assert.ok(!ui.questions.includes("secret:OpenAI LLM API key"));
    assert.ok(!ui.questions.includes("Model configuration file"));
    assert.match(ui.notes.join(), /Prepaid usage/);
    assert.ok(!ui.notes.join().includes("$1"));
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
    assert.equal(routes.defaultModel, "openai/gpt-6-astra");
    assert.deepEqual(routes.models[0]?.route, {
      model: "openai/openai/gpt-6-astra",
      apiKeyEnv: "CLAWSCARF_CLOUD_AI_KEY",
      apiBase: "https://cloud.clawscarf.com/v1",
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
    const customized = await collectInstallation(supplied, {
      ...f,
      directory: join(f.parent, "supplied"),
      recipe: f.recipe,
      agentName: "Atlas",
    });
    assert.equal(customized.config.agentName, "Atlas");
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
  "noninteractive provider setup rejects missing credentials and unknown models before creating files",
  local,
  async (t) => {
    const f = await fixture(t);
    const { prepareConfiguration } =
      await import("./installation/configure.js");
    await assert.rejects(
      prepareConfiguration({
        recipe: f.recipe,
        directory: f.directory,
        aiService: "provider",
      }),
      { code: "invalid_configuration" },
    );
    await assert.rejects(
      prepareConfiguration({
        recipe: f.recipe,
        directory: f.directory,
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
    const { gatewayRoutesSchema } = await import("./models/configuration.js");
    const ui = new Answers(
      {
        ...f.answers,
        "Default model": "claude-sonnet-5",
        Provider: "anthropic/claude-sonnet-5",
        "secret:Anthropic API key": "selected-secret",
        Reasoning: "high",
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
      ["claude-sonnet-5"],
    );
    assert.equal(routes.thinkingDefault, "high");
    assert.ok(ui.questions.includes("secret:Anthropic API key"));
    assert.ok(!ui.questions.includes("secret:OpenAI API key"));
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
            [
              "review",
              "public-web",
              "ai-service",
              "models",
              "connections",
              "packs",
              "model-credentials",
            ],
          );
        return super.select(message, choices, initial);
      }
    }
    const result = await collectInstallation(
      new DiscardKey({ ...f.answers, "secret:OpenAI API key": "discard-me" }, [
        "model-credentials",
      ]),
      { recipe: f.recipe, existing: true },
      first,
    );
    assert.deepEqual(result.config, original);
    assert.deepEqual(result.inputs.files, inputs);
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
  },
);

await test(
  "configure after deletion explains recovery without reusing retained settings",
  local,
  async (t) => {
    const f = await fixture(t);
    const draft = await collectInstallation(new Answers(f.answers), f);
    await mkdir(f.directory, { mode: 0o700 });
    const state = join(f.directory, "state");
    await mkdir(state, { mode: 0o700 });
    const settings = JSON.stringify({ ...draft.config, stateDirectory: state });
    await writeFile(join(f.directory, "installation.json"), settings);
    await writeFile(join(state, "settings.json"), settings);
    // Deletion removes prepared.json before touching Docker, retaining settings
    // both on success and on failure so cleanup can be retried safely.
    await assert.rejects(
      runConfiguration({ directory: f.directory, nonInteractive: true }),
      (error: unknown) => {
        assert.ok(error instanceof Error && "code" in error);
        assert.equal(error.code, "invalid_configuration");
        assert.match(
          error.message,
          /If deletion failed, finish it with clawscarf stop/,
        );
        assert.match(
          error.message,
          /After successful deletion, move or remove/,
        );
        return true;
      },
    );
    assert.equal(
      await readFile(join(state, "settings.json"), "utf8"),
      settings,
    );
    assert.deepEqual(await readdir(state), ["settings.json"]);
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
    const ownerId = randomUUID();
    await writeFile(
      join(state, "installation.json"),
      JSON.stringify({ schemaVersion: 1, ownerId }),
    );
    const accepted = JSON.stringify({ ...first.config, stateDirectory: state });
    await writeFile(join(state, "settings.json"), accepted, { mode: 0o600 });
    await writeFile(join(state, "prepared.json"), JSON.stringify({ ownerId }));
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
    assert.deepEqual(await readdir(state), [
      "installation.json",
      "prepared.json",
      "settings.json",
    ]);
  },
);

for (const mode of ["menu", "flags"] as const)
  await test(
    `switching retained Cloud AI to an own-key model needs only its selected provider (${mode})`,
    local,
    async (t) => {
      const f = await fixture(t);
      await writeFile(
        f.release,
        JSON.stringify({
          ...releaseSchema.parse(await readJson(f.release)),
          cloudBilling: true,
        }),
      );
      const first = await collectInstallation(new Answers(f.answers), f);
      const { setupContext } = await import("./installation/setup.js");
      const { selectAiService } = await import("./installation/models.js");
      const { selectedDraft } = await import("./installation/options.js");
      const { gatewayRoutesSchema } = await import("./models/configuration.js");
      const context = await setupContext(f);
      first.config.models = await selectAiService(
        "cloud",
        first.config.models,
        context.modelCatalog,
        first.inputs,
      );
      const key = join(f.parent, "openrouter-key");
      await writeFile(key, "test-own-provider-key", { mode: 0o600 });
      const ui = new Answers(
        {
          ...f.answers,
          "AI service": "provider",
          "Default model": "gpt-5.6-luna",
          Provider: "openrouter/openai/gpt-5.6-luna",
          Reasoning: "low",
          "secret:OpenRouter API key": "test-own-provider-key",
        },
        ["ai-service", "models"],
      );
      const result =
        mode === "menu"
          ? await collectInstallation(
              ui,
              { recipe: f.recipe, existing: true },
              first,
            )
          : {
              inputs: first.inputs,
              config: await selectedDraft(
                context,
                "team-server",
                {
                  aiService: "provider",
                  provider: "openrouter",
                  model: "gpt-5.6-luna",
                  reasoning: "low",
                  llmKeyFile: key,
                },
                first.inputs,
                first.config,
              ),
            };
      const models = result.config.models;
      assert.equal(models?.mode, "litellm");
      assert.equal(models.cloud, undefined);
      const routes = gatewayRoutesSchema.parse(
        await result.inputs.readJson(models.configurationFile),
      );
      assert.deepEqual(
        routes.models.map((model) => model.route?.model),
        ["openrouter/openai/gpt-5.6-luna"],
      );
      assert.equal(routes.defaultModel, "gpt-5.6-luna");
      assert.equal(routes.thinkingDefault, "low");
      assert.ok(models.upstreamEnvironmentFile);
      assert.ok(!ui.questions.includes("secret:OpenAI API key"));
    },
  );

await test(
  "retained default changes preserve previously configured model routes for native overrides",
  local,
  async (t) => {
    const f = await fixture(t);
    const first = await collectInstallation(new Answers(f.answers), f);
    const { gatewayRoutesSchema } = await import("./models/configuration.js");
    const result = await collectInstallation(
      new Answers(
        {
          ...f.answers,
          "Default model": "gpt-6-astra",
          Provider: "openai/gpt-6-astra",
          Reasoning: "medium",
        },
        ["models"],
      ),
      { recipe: f.recipe, existing: true },
      first,
    );
    const changed = gatewayRoutesSchema.parse(
      await result.inputs.readJson(result.config.models.configurationFile),
    );
    assert.deepEqual(
      changed.models.map((model) => model.id),
      ["team", "gpt-6-astra"],
    );
    assert.equal(changed.defaultModel, "gpt-6-astra");
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
      recipe: f.recipe,
      directory: f.directory,
      modelCatalog: f.modelCatalog,
      providerEnvFile: f.providerEnvFile,
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
      "team-server",
      f,
      new SetupInputs(f.directory),
    );
    assert.equal(first.publicWeb, true, "Team recipe enables public web");
    const strict = await selectedDraft(
      context,
      "team-server",
      { publicWeb: false },
      new SetupInputs(f.directory),
      first,
    );
    assert.equal(strict.publicWeb, false);
    const retained = await selectedDraft(
      context,
      "team-server",
      {},
      new SetupInputs(f.directory),
      strict,
    );
    assert.equal(
      retained.publicWeb,
      false,
      "Unrelated edits preserve strict egress",
    );
    const enabled = await selectedDraft(
      context,
      "team-server",
      { publicWeb: true },
      new SetupInputs(f.directory),
      retained,
    );
    assert.equal(enabled.publicWeb, true);
    const key = join(f.parent, "new-key");
    await writeFile(key, "rotated-key", { mode: 0o600 });
    const inputs = new SetupInputs(f.directory);
    const updated = await selectedDraft(
      context,
      "team-server",
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
          "team-server",
          options,
          new SetupInputs(f.directory),
          first,
        ),
        { code: "invalid_configuration" },
      );
    await assert.rejects(
      selectedDraft(
        context,
        "team-server",
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
    const prerequisites = {
      host: () => Promise.resolve(),
      check: () =>
        Promise.resolve({
          state: "prerequisites_available",
          platform: "darwin-arm64",
          release: "0.1.0-dev",
          images: 0,
        }),
    };
    const f = await fixture(t);
    const first = await collectInstallation(new Answers(f.answers), f);
    const configFile = await saveConfiguration(
      first.directory,
      first.config,
      first.inputs,
    );
    const state = join(f.directory, "state");
    const { resolveInstallation } = await import("./installation/resolve.js");
    const { initializeState } = await import("./deployment/state.js");
    const { launchLocal } = await import("./deployment/launch.js");
    const resolved = await resolveInstallation(
      configFile,
      [29001, 29002, 29003, 29004, 29005, 29006, 29007],
    );
    const installation = await initializeState(state, resolved.input);
    const config = resolveConfigurationInputs(
      installationSchema.parse(await readJson(configFile)),
      first.directory,
    );
    const accepted = JSON.stringify({ ...config, stateDirectory: state });
    await writeFile(join(state, "settings.json"), accepted, { mode: 0o600 });
    await writeFile(
      join(state, "prepared.json"),
      JSON.stringify({ ownerId: installation.ownerId }),
    );
    const app = Fastify();
    t.after(() => app.close());
    app.get("/api/identity", (_request, reply) =>
      reply.code(503).send({ error: "unavailable" }),
    );
    const cloudUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    await assert.rejects(
      () =>
        editInstallationSettings(
          state,
          unattendedPrompts,
          {
            nonInteractive: true,
            yes: true,
            connections: true,
            connectionsCloudUrl: cloudUrl,
          },
          prerequisites,
        ),
      { code: "unavailable" },
    );
    const before = await readJson(join(state, "prepared.json"));
    assert.equal(
      await readFile(join(state, "settings.json"), "utf8"),
      accepted,
    );
    await assert.rejects(
      () =>
        editInstallationSettings(
          state,
          unattendedPrompts,
          {
            nonInteractive: true,
            yes: true,
          },
          prerequisites,
        ),
      { code: "unavailable" },
    );
    assert.deepEqual(await readJson(join(state, "prepared.json")), before);
    assert.equal(
      (await readdir(state)).filter((name) => name.startsWith(".settings-"))
        .length,
      1,
    );
    // Reach the next startup guard: authorization alone must not invalidate preparation.
    process.env.OPENSHELL_REVIEW_TEST = "1";
    try {
      await assert.rejects(
        launchLocal(state, () => {}),
        { code: "configuration_changed" },
      );
    } finally {
      delete process.env.OPENSHELL_REVIEW_TEST;
    }
    class Discard extends Answers {
      override confirm() {
        return Promise.resolve(false);
      }
    }
    assert.equal(
      (await editInstallationSettings(state, new Discard(f.answers))).state,
      "cancelled",
    );
    assert.deepEqual(await readJson(join(state, "prepared.json")), {
      ownerId: installation.ownerId,
    });
    assert.equal(
      (await readdir(state)).filter((name) => name.startsWith(".settings-"))
        .length,
      0,
    );
  },
);

await test(
  "authorization resume preserves an explicit no-start selection",
  local,
  async (t) => {
    const f = await fixture(t);
    const { CloudAuthorizationRequired } = await import("./cloud/login.js");
    const { unattendedPrompts } =
      await import("./installation/installer/prompts.js");
    let authorized = false;
    const operators: NonNullable<Parameters<typeof installFromAnswers>[2]> = {
      register: () => {
        if (!authorized)
          throw new CloudAuthorizationRequired({
            url: "https://cloud.example.test/setup?code=TEST-TEST",
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            retryAfterSeconds: 5,
          });
        return Promise.resolve();
      },
      plan: planInstallation,
      host: () => Promise.resolve(),
      ports: () => Promise.resolve(),
      prerequisites: () =>
        Promise.resolve({
          state: "prerequisites_available",
          platform: "darwin-arm64",
          release: "0.1.0-dev",
          images: 0,
        }),
      apply: () =>
        Promise.resolve({
          state: "prepared",
          directory: f.directory,
          release: "0.1.0-dev",
        }),
      start: () => {
        throw Error("Must not start");
      },
      administrator: () => {
        throw Error("Must not request administrator login before start");
      },
    };
    const first = await installFromAnswers(
      { ...f, recipe: f.recipe, nonInteractive: true, start: false },
      unattendedPrompts,
      operators,
    );
    assert.equal(first.state, "action_required");
    assert.ok("resume" in first);
    assert.match(first.resume, /--no-start/);
    authorized = true;
    const resumed = await installFromAnswers(
      { directory: f.directory, nonInteractive: true, start: false },
      unattendedPrompts,
      operators,
    );
    assert.equal(resumed.state, "prepared");
  },
);

await test(
  "unchanged retained selections do not contact cloud or Docker; copies compare by content",
  local,
  async (t) => {
    const { configurationChanges, resolveConfigurationInputs } =
      await import("./installation/configure.js");
    const { editInstallationSettings } =
      await import("./installation/installer/settings.js");
    const { unattendedPrompts } =
      await import("./installation/installer/prompts.js");
    const f = await fixture(t);
    const first = await collectInstallation(new Answers(f.answers), f);
    const file = await saveConfiguration(
      first.directory,
      first.config,
      first.inputs,
    );
    const state = join(f.directory, "state");
    await mkdir(state, { mode: 0o700 });
    const ownerId = randomUUID();
    await writeFile(
      join(state, "installation.json"),
      JSON.stringify({ schemaVersion: 1, ownerId }),
    );
    const accepted = {
      ...resolveConfigurationInputs(
        installationSchema.parse(await readJson(file)),
        first.directory,
      ),
      stateDirectory: state,
    };
    await writeFile(join(state, "settings.json"), JSON.stringify(accepted));
    await writeFile(join(state, "prepared.json"), JSON.stringify({ ownerId }));
    assert.deepEqual(
      await editInstallationSettings(state, unattendedPrompts, {
        nonInteractive: true,
        yes: true,
      }),
      { state: "unchanged" },
    );
    const copiedFile = await saveConfiguration(
      join(state, "candidate"),
      accepted,
      undefined,
      true,
    );
    const copied = resolveConfigurationInputs(
      installationSchema.parse(await readJson(copiedFile)),
      dirname(copiedFile),
    );
    assert.deepEqual(await configurationChanges(accepted, copied), {
      models: false,
      connections: false,
      publicWeb: false,
      packs: false,
    });
    copied.connections.mode = "hosted";
    assert.deepEqual(await configurationChanges(accepted, copied), {
      models: false,
      connections: true,
      publicWeb: false,
      packs: false,
    });
    copied.models = { ...copied.models };
    if (copied.models.mode === "litellm") {
      await writeFile(
        copied.models.upstreamEnvironmentFile,
        "PROVIDER_KEY=changed\n",
        { mode: 0o600 },
      );
      assert.deepEqual(await configurationChanges(accepted, copied), {
        models: true,
        connections: true,
        publicWeb: false,
        packs: false,
      });
    }
  },
);

await test("recipe model choices resolve catalog metadata and reject missing or unsupported offerings", async () => {
  const { recipeModelRoutes } = await import("./installation/models.js");
  const { modelCatalogSchema } = await import("./models/catalog.js");
  const catalog = modelCatalogSchema.parse(
    await readJson("deploy/models/catalog.json"),
  );
  const choice = {
    model: "gpt-6-astra",
    provider: "openai",
    reasoning: "medium" as const,
  };
  const routes = recipeModelRoutes(choice, catalog);
  assert.equal(routes.models[0]?.api, "openai-responses");
  assert.deepEqual(routes.models[0], catalog[0]?.model);
  assert.throws(() => recipeModelRoutes(choice, []), {
    code: "invalid_configuration",
  });
  assert.throws(
    () =>
      recipeModelRoutes(
        choice,
        catalog.map((item) => ({ ...item, reasoningLevels: [] })),
      ),
    { code: "invalid_configuration" },
  );
});

await test(
  "prerequisites need no cloud registration; missing images, tools and occupied ports stop setup",
  local,
  async (t) => {
    const { checkInstallationPrerequisites, checkNewInstallationPorts } =
      await import("./installation/prerequisites.js");
    const { LocalSetupError } = await import("./deployment/process.js");
    const { allocatePorts } = await import("./installation/resolve.js");
    const { prepareConfiguration } =
      await import("./installation/configure.js");
    const { createServer } = await import("node:net");
    const f = await fixture(t);
    const draft = await prepareConfiguration({
      ...f,
      recipe: f.recipe,
      nonInteractive: true,
    });
    const ports = await allocatePorts();
    draft.config.exposure = {
      mode: "local",
      applicationPort: ports[0] ?? 0,
      widgetPort: ports[1] ?? 0,
    };
    draft.config.access = {
      mode: "hosted",
      administratorName: "Admin",
      registrationFile: "./not-created.json",
      cloudUrl: "https://cloud.example.test",
    };
    const file = await saveConfiguration(
      f.directory,
      draft.config,
      draft.inputs,
    );
    const messages: string[] = [],
      pulled: string[] = [];
    let missing = new Set([postgresImage]);
    const command: typeof import("./deployment/process.js").run = (
      _executable,
      args,
    ) => {
      if (missing.has(args.at(-1) ?? ""))
        throw new LocalSetupError("command_failed", "fixture", {
          reason: "exit",
          exitCode: 1,
        });
      return Promise.resolve(
        args[0] === "info"
          ? "linux"
          : args[0] === "version"
            ? "29.0.0"
            : args.includes("--format")
              ? "team-runtime"
              : "[]",
      );
    };
    const pull: typeof import("./installation/prerequisites.js").pullImage = (
      image,
    ) => {
      pulled.push(image);
      missing.delete(image);
      return Promise.resolve();
    };
    await assert.rejects(
      checkInstallationPrerequisites(file, {}, command, pull),
      /Run configure to download/,
    );
    assert.deepEqual(pulled, []);
    await checkInstallationPrerequisites(
      file,
      { acquire: true, report: (message) => messages.push(message) },
      command,
      pull,
    );
    assert.deepEqual(pulled, [postgresImage]);
    assert.ok(
      messages.some(
        (message) =>
          message.includes(postgresImage) && message.includes("first setup"),
      ),
    );
    await checkInstallationPrerequisites(
      file,
      { acquire: true },
      command,
      pull,
    );
    assert.deepEqual(pulled, [postgresImage]);
    missing = new Set([`sha256:${"a".repeat(64)}`]);
    await assert.rejects(
      checkInstallationPrerequisites(file, { acquire: true }, command, pull),
      /cannot be downloaded/,
    );
    assert.deepEqual(pulled, [postgresImage]);
    missing.clear();
    await writeFile(join(f.directory, "runtime/tools/openshell"), "tampered");
    await assert.rejects(
      checkInstallationPrerequisites(file, { acquire: true }, command, pull),
      /checksum/,
    );
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    t.after(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          }),
        ),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(
      checkNewInstallationPorts({
        mode: "local",
        applicationPort: address.port,
        widgetPort: ports[1] ?? 0,
      }),
      /already in use/,
    );
  },
);

await test(
  "machine checks distinguish missing Docker, stopped daemon, wrong container OS and absent Compose",
  local,
  async () => {
    const { checkHost } = await import("./installation/prerequisites.js");
    const { LocalSetupError } = await import("./deployment/process.js");
    await assert.rejects(
      checkHost(() => {
        throw new LocalSetupError("command_failed", "hidden", {
          reason: "spawn",
          systemCode: "ENOENT",
        });
      }),
      /Docker is not installed/,
    );
    await assert.rejects(
      checkHost(() => {
        throw new LocalSetupError("command_failed", "hidden", {
          reason: "exit",
          exitCode: 1,
        });
      }),
      /Cannot reach Docker/,
    );
    await assert.rejects(
      checkHost(() => Promise.resolve("windows")),
      /Linux containers/,
    );
    await assert.rejects(
      checkHost((_exe, args) => {
        if (args[0] === "compose") throw Error("hidden");
        return Promise.resolve("linux");
      }),
      /Compose is unavailable/,
    );
    for (const version of ["28.5.1", "invalid"])
      await assert.rejects(
        checkHost((_exe, args) =>
          Promise.resolve(args[0] === "version" ? version : "linux"),
        ),
        /Docker Engine 29 or newer/,
      );
    await checkHost((_exe, args) =>
      Promise.resolve(args[0] === "version" ? "29.0.0" : "linux"),
    );
  },
);

await test("image download reports layer progress, hides registry errors and supports cancellation", async (t) => {
  const { pullImage } = await import("./installation/prerequisites.js");
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-pull-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const docker = join(directory, "docker");
  const previous = process.env.PATH;
  process.env.PATH = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  });
  const messages: string[] = [];
  await writeFile(
    docker,
    '#!/bin/sh\nprintf "abcdef123456: Downloading [==> ] 2MB/8MB\\n"\nprintf "registry-token-must-not-appear\\n" >&2\nexit 1\n',
    { mode: 0o700 },
  );
  await assert.rejects(
    pullImage("example/image@sha256:test", (message) => {
      messages.push(message);
    }),
    /Could not download example\/image/,
  );
  assert.equal(messages.length, 1);
  assert.match(messages[0] ?? "", /2MB\/8MB/);
  assert.ok(!messages.some((message) => message.includes("registry-token")));
  await writeFile(docker, "#!/bin/sh\nexec /bin/sleep 20\n");
  const controller = new AbortController();
  const running = pullImage(
    "example/image@sha256:test",
    () => {},
    controller.signal,
  );
  controller.abort(new InstallerCancelled());
  await assert.rejects(running, InstallerCancelled);
});

await test(
  "no recipe flag uses the published runtime with provider-key AI and staging login",
  local,
  async (t) => {
    const f = await fixture(t);
    const ui = new Answers({
      ...f.answers,
      "Starting point": "team-server",
    });
    const result = await collectInstallation(ui, {
      directory: f.directory,
      cloudUrl: "https://cloud-staging.clawscarf.com",
      aiService: "provider",
    });
    assert.ok(ui.questions.includes("Starting point"));
    assert.equal(result.config.releaseFile, resolve("runtime/current.json"));
    assert.equal(result.config.connections.mode, "hosted");
    assert.equal(
      result.config.connections.cloudUrl,
      "https://cloud-staging.clawscarf.com",
    );
    assert.equal(result.config.access.mode, "hosted");
    assert.equal(
      result.config.access.cloudUrl,
      result.config.connections.cloudUrl,
    );
    await assert.rejects(lstat(f.directory), { code: "ENOENT" });
  },
);

await test(
  "Cloud AI refuses an older runtime before reading registration secrets",
  local,
  async (t) => {
    const f = await fixture(t);
    const draft = await collectInstallation(new Answers(f.answers), f);
    assert.equal(draft.config.models.mode, "litellm");
    draft.config.models.cloud = {
      url: "https://cloud.example",
      registrationFile: "secrets/not-registered.json",
    };
    const file = await saveConfiguration(
      f.directory,
      draft.config,
      draft.inputs,
    );
    const { resolveInstallation } = await import("./installation/resolve.js");
    await assert.rejects(
      resolveInstallation(file, []),
      /runtime predates Cloud AI/,
    );
  },
);

await test(
  "Cloud AI keeps its chosen registration when optional Connections is disabled",
  local,
  async (t) => {
    const f = await fixture(t);
    const draft = await collectInstallation(new Answers(f.answers), f);
    assert.equal(draft.config.models.mode, "litellm");
    const cloudUrl = "https://cloud.example";
    draft.config.models.cloud = {
      url: cloudUrl,
      registrationFile: "./secrets/ai-registration.json",
    };
    draft.config.connections = {
      ...draft.config.connections,
      mode: "hosted",
      cloudUrl,
    };
    const file = await saveConfiguration(
      f.directory,
      draft.config,
      draft.inputs,
    );
    const original = installationSchema.parse(await readJson(file));
    const { aiRegistration } = await import("./cloud/registration.js");
    assert.equal(
      aiRegistration(original)?.registrationFile,
      original.connections.registrationFile,
    );
    const { resolveConfigurationInputs } =
      await import("./installation/configure.js");
    const accepted = resolveConfigurationInputs(original, f.directory);
    accepted.connections = { ...accepted.connections, mode: "disabled" };
    const retained = await saveConfiguration(
      join(f.parent, "retained-ai"),
      accepted,
      undefined,
      true,
    );
    const next = installationSchema.parse(await readJson(retained));
    assert.deepEqual(
      aiRegistration(next),
      aiRegistration(resolveConfigurationInputs(original, f.directory)),
    );
  },
);
