import { z } from "zod";
import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";
import {
  configurationSchema,
  gatewayRoutesSchema,
  liteLlmConfiguration,
} from "../models/configuration.js";
import { issueRuntimeCredential } from "../models/credentials.js";
import { ensurePrivateFile, writePrivate, type LocalState } from "./state.js";
import { LocalSetupError } from "./process.js";
import { compose } from "./compose.js";

export async function loadGatewayConfiguration(
  configurationFile: string,
  environmentFile: string,
) {
  const routes = gatewayRoutesSchema.parse(
    JSON.parse(await readFile(configurationFile, "utf8")),
  );
  const configuration = configurationSchema.parse({
    ...routes,
    mode: "litellm",
    baseUrl: "https://host.docker.internal/v1",
  });
  if (configuration.mode !== "litellm" || !configuration.defaultModel)
    throw new LocalSetupError(
      "invalid_model_setup",
      "Local models require LiteLLM routes and an enabled default.",
    );
  const environment = parseEnv(await readFile(environmentFile, "utf8"));
  const required = new Set(
    configuration.models
      .filter((m) => m.enabled)
      .map((m) => m.route?.apiKeyEnv),
  );
  if (
    Object.keys(environment).some(
      (k) =>
        !required.has(k) ||
        [
          "DATABASE_URL",
          "LITELLM_MASTER_KEY",
          "STORE_MODEL_IN_DB",
          "LITELLM_LOG",
        ].includes(k) ||
        /[\r\n]/.test(environment[k] ?? ""),
    ) ||
    [...required].some((k) => !k || !environment[k])
  )
    throw new LocalSetupError(
      "invalid_model_setup",
      "The upstream environment file must contain exactly the enabled routes' credential variables.",
    );
  return { configuration, environment };
}

/** Generate local service credentials once, outside the Gateway and its image. */
export async function prepareModelGateway(
  directory: string,
  state: LocalState,
  options: { replaceConfiguration?: boolean } = {},
) {
  const input = state.input.modelGateway;
  const publish = options.replaceConfiguration
    ? writePrivate
    : ensurePrivateFile;
  if (!input) return;
  const loaded = await loadGatewayConfiguration(
    input.configurationFile,
    input.upstreamEnvironmentFile,
  );
  const root = join(directory, "private/models");
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const [name, prefix] of [
    ["master-key", "sk-"],
    ["database-password", ""],
  ] as const) {
    try {
      await readFile(join(root, name));
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      await ensurePrivateFile(
        join(root, name),
        prefix + randomBytes(32).toString("hex"),
      );
    }
  }
  const password = (
    await readFile(join(root, "database-password"), "utf8")
  ).trim();
  const master = (await readFile(join(root, "master-key"), "utf8")).trim();
  const environment = {
    ...loaded.environment,
    LITELLM_MASTER_KEY: master,
    DATABASE_URL: `postgresql://models:${password}@models-database:5432/models`,
    STORE_MODEL_IN_DB: "False",
    LITELLM_LOG: "ERROR",
  };
  await publish(
    join(root, "gateway.env"),
    Object.entries(environment)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
  );
  await publish(
    join(root, "models.json"),
    JSON.stringify(liteLlmConfiguration(loaded.configuration)),
  );
  await publish(
    join(root, "native.json"),
    JSON.stringify({
      ...loaded.configuration,
      baseUrl: `https://host.docker.internal:${String(input.port)}/v1`,
    }),
  );
}

export async function prepareModelCredential(
  directory: string,
  state: LocalState,
) {
  if (!state.input.modelGateway) return;
  const root = join(directory, "private/models");
  const output = join(root, "runtime-key");
  try {
    const key = await readFile(output, "utf8");
    z.string().startsWith("sk-").parse(key.trim());
    return;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const intent = join(root, "issuance-started");
  try {
    await readFile(intent);
    throw new LocalSetupError(
      "model_credential_pending",
      "Model credential issuance is unconfirmed. Inspect LiteLLM before an explicit retry; installation will not issue another key.",
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  try {
    await compose(directory, [
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "120",
      "models",
    ]);
    const configuration = configurationSchema.parse(
      JSON.parse(await readFile(join(root, "native.json"), "utf8")),
    );
    await ensurePrivateFile(intent, state.ownerId);
    await issueRuntimeCredential({
      origin: `https://127.0.0.1:${String(state.input.modelGateway.port)}`,
      masterKeyFile: join(root, "master-key"),
      output,
      configuration,
      caFile: join(directory, "private/management-ca.pem"),
    });
  } finally {
    await compose(directory, ["stop", "models", "models-database"]);
  }
}
