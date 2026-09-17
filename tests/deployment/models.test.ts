import {
  initialRuntimePolicy,
  prepareRuntimePolicy,
} from "../../scripts/deployment/policy.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialConfiguration } from "../../runtime/configuration.js";
import {
  loadInitialModels,
  prepareInitialModels,
  withInitialModels,
} from "../../scripts/deployment/models.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { X509Certificate } from "node:crypto";
import { LocalSetupError } from "../../scripts/deployment/process.js";
import { nativeAssignments } from "../../scripts/models/configuration.js";

const config = {
  mode: "external",
  baseUrl: "https://host.docker.internal:14400/v1",
  defaultModel: "team-model",
  thinkingDefault: "medium",
  models: [
    {
      id: "team-model",
      name: "Team model",
      enabled: true,
      contextWindow: 32000,
      maxTokens: 4096,
      reasoning: false,
      tools: true,
      input: ["text"],
    },
  ],
};
const policy = await readFile(
  new URL("../../deploy/openshell/policy.yaml", import.meta.url),
  "utf8",
);
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-model-setup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "private"), { mode: 0o700 });
  const input = {
    configurationFile: join(directory, "models.json"),
    runtimeKeyFile: join(directory, "key"),
  };
  await writeFile(input.configurationFile, JSON.stringify(config));
  await writeFile(input.runtimeKeyFile, "test-scoped-runtime-key\n", {
    mode: 0o600,
  });
  return { directory, input };
}

await test("initial setup binds the scoped secret and only the declared Node HTTPS endpoint", async (t) => {
  const { input } = await fixture(t);
  const models = await loadInitialModels(input);
  assert.ok(models);
  const native = initialConfiguration({
    publicOrigin: "http://127.0.0.1:18800",
    widgetOrigin: "http://127.0.0.1:18802",
    administratorIdentity: "test-admin",
  });
  const configured = withInitialModels(native, models);
  assert.ok(
    "secrets" in configured &&
      "providers" in configured.models &&
      "agents" in configured,
  );
  assert.deepEqual(configured.models.providers.clawscarf.apiKey, {
    source: "file",
    provider: "clawscarf-models",
    id: "/token",
  });
  assert.equal(
    configured.secrets.providers["clawscarf-models"].path,
    "/home/node/.openclaw/clawscarf-models/initial.json",
  );
  assert.equal(
    configured.agents.defaults.model?.primary,
    "clawscarf/team-model",
  );
  assert.equal(configured.agents.defaults.thinkingDefault, "medium");
  for (const assignment of nativeAssignments(models.configuration)) {
    if (assignment.path === "agents.defaults.model.primary")
      assert.equal(assignment.value, configured.agents.defaults.model?.primary);
    if (assignment.path === "agents.defaults.thinkingDefault")
      assert.equal(
        assignment.value,
        configured.agents.defaults.thinkingDefault,
      );
  }
  assert.equal(
    JSON.stringify(configured).includes(models.credential.token),
    false,
  );
  assert.deepEqual(configured.gateway, native.gateway);
  assert.deepEqual(configured.plugins, native.plugins);
  const enabled = initialRuntimePolicy(policy, models);
  const disabled = initialRuntimePolicy(policy, undefined);
  assert.deepEqual(enabled.network_policies, {
    model_gateway: {
      name: "Model gateway",
      endpoints: [{ host: "host.docker.internal", port: 14400, tls: "skip" }],
      binaries: [{ path: "/usr/local/bin/node" }],
    },
  });
  assert.deepEqual({ ...enabled, network_policies: {} }, disabled);
  assert.equal(withInitialModels(native, undefined), native);
  assert.equal(await loadInitialModels(undefined), undefined);
  assert.throws(
    () =>
      initialRuntimePolicy(
        "network_policies: {}\nnetwork_policies: {}",
        models,
      ),
    LocalSetupError,
  );
  assert.throws(
    () =>
      initialRuntimePolicy("network_policies: {allow_everything: {}}", models),
    LocalSetupError,
  );
});

await test("invalid optional model inputs fail without writing private setup or leaking their contents", async (t) => {
  const { directory, input } = await fixture(t);
  for (const invalid of [
    { mode: "disabled" },
    { ...config, defaultModel: null },
    { ...config, defaultModel: "missing" },
    { ...config, baseUrl: "http://127.0.0.1:14400/v1" },
    { ...config, baseUrl: "https://127.0.0.1:14400/v1" },
    { ...config, baseUrl: "https://localhost:14400/v1" },
    { ...config, baseUrl: "https://secret:password@gateway.example/v1" },
    { ...config, apiKey: "must-not-leak" },
  ]) {
    await writeFile(input.configurationFile, JSON.stringify(invalid));
    await assert.rejects(
      prepareInitialModels(directory, input),
      (error: unknown) =>
        error instanceof LocalSetupError &&
        error.code === "invalid_model_setup" &&
        !error.message.includes("must-not-leak"),
    );
  }
  await writeFile(input.configurationFile, JSON.stringify(config));
  for (const key of ["", "  \n", "x".repeat(65537)]) {
    await writeFile(input.runtimeKeyFile, key);
    await assert.rejects(loadInitialModels(input), LocalSetupError);
  }
  await writeFile(input.runtimeKeyFile, "scoped-key");
  const caFile = join(directory, "bad.pem");
  await writeFile(caFile, "not a CA");
  await assert.rejects(
    loadInitialModels({ ...input, caFile }),
    LocalSetupError,
  );
  await assert.rejects(stat(join(directory, "private/model-bootstrap.json")));
  await assert.rejects(stat(join(directory, "private/runtime-policy.json")));
});

await test("repeated preparation keeps private initial material and rejects changed source inputs", async (t) => {
  const { directory, input } = await fixture(t);
  await prepareRuntimePolicy(
    directory,
    await prepareInitialModels(directory, input),
    undefined,
  );
  const keyPath = join(directory, "private/model-bootstrap.json");
  const policyPath = join(directory, "private/runtime-policy.json");
  const snapshot = await readFile(keyPath);
  const initialPolicy = await readFile(policyPath);
  assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
  assert.equal((await stat(policyPath)).mode & 0o777, 0o600);
  assert.equal(initialPolicy.includes("test-scoped-runtime-key"), false);
  await prepareRuntimePolicy(
    directory,
    await prepareInitialModels(directory, input),
    undefined,
  );
  assert.deepEqual(await readFile(keyPath), snapshot);
  await writeFile(input.runtimeKeyFile, "replacement-key");
  await assert.rejects(
    prepareInitialModels(directory, input),
    (error: unknown) =>
      error instanceof LocalSetupError &&
      error.code === "configuration_changed",
  );
  assert.deepEqual(await readFile(keyPath), snapshot);
  assert.deepEqual(await readFile(policyPath), initialPolicy);
});

await test("initial private gateway trust accepts an explicitly trusted self-signed server certificate", async (t) => {
  const { directory, input } = await fixture(t);
  const caFile = join(directory, "server.pem");
  await promisify(execFile)("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=host.docker.internal",
    "-addext",
    "basicConstraints=critical,CA:FALSE",
    "-keyout",
    join(directory, "server.key"),
    "-out",
    caFile,
  ]);
  const pem = await readFile(caFile, "utf8");
  assert.equal(new X509Certificate(pem).ca, false);
  const models = await loadInitialModels({ ...input, caFile });
  assert.equal(models?.credential.ca, pem);
});
