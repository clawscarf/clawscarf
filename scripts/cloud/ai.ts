import { rm } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { createClient } from "../../generated/http/client/index.js";
import * as api from "../../services/cloud/generated/sdk.gen.js";
import { writePrivate } from "../deployment/state.js";
import { readInputFile, readJson } from "../installation/files.js";
import { InstallationError } from "../installation/errors.js";
import type { InstallationConfiguration } from "../installation/configuration.js";
import {
  cloudAiVariable,
  cloudModelsSchema,
  validateCloudRoutes,
} from "./models.js";

const intentSchema = z.strictObject({
  installationId: z.uuid(),
  url: z.url(),
  configuration: z
    .strictObject({
      requestId: z.uuid(),
      revision: z.number().int().nonnegative(),
      enabled: z.literal(true),
      modelIds: z.array(z.string()).min(1),
    })
    .optional(),
  credential: z
    .strictObject({
      requestId: z.uuid(),
      generation: z.number().int().nonnegative(),
      secret: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
    })
    .optional(),
  activeGeneration: z.number().int().positive().optional(),
});
const configurationSchema = z.object({
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  modelIds: z.array(z.string()),
  generation: z.number().int().nonnegative(),
  credentialActive: z.boolean(),
  inferenceUrl: z.url(),
});
/** Temporary owner authorization stays inside the installer process. Never serialize this value. */
export interface CloudAiSession {
  url: string;
  installationId: string;
  accountId: string;
  authorization: string;
  registrationFile: string;
}

/** Owner approval and caller-retained intents make interrupted enablement safe to resume. */
async function configure(
  configFile: string,
  models: InstallationConfiguration["models"],
  registration: {
    cloudUrl: string;
    accountId?: string | undefined;
    installationId?: string | undefined;
  },
  registrationFile: string,
  authorize: (
    url: string,
    file: string,
    administrator: boolean,
  ) => Promise<string>,
) {
  if (models.mode !== "litellm" || !models.cloud) return;
  const id = registration.installationId;
  if (
    !id ||
    !registration.accountId ||
    registration.cloudUrl !== models.cloud.url
  )
    throw new InstallationError(
      "invalid_configuration",
      "Cloud AI registration is incomplete or belongs to another service.",
    );
  const routes = validateCloudRoutes(
    await readJson(resolve(dirname(configFile), models.configurationFile)),
    models.cloud.url,
  );
  const client = createClient({ baseUrl: models.cloud.url, redirect: "error" });
  const auth = await authorize(
    models.cloud.url,
    registrationFile + ".login",
    false,
  );
  const request = {
    client,
    headers: { authorization: `Bearer ${auth}` },
    get signal() {
      return AbortSignal.timeout(60_000);
    },
  };
  const account = await api.getAccount(request);
  if (account.response?.status === 401)
    await rm(registrationFile + ".login", { force: true });
  if (!account.data || account.data.accountId !== registration.accountId)
    throw new InstallationError(
      "invalid_configuration",
      "Sign in with the Cloud account that owns this installation to enable AI.",
    );
  const available = await api.getAiModels(request);
  if (!available.data)
    throw new InstallationError(
      "unavailable",
      "Cloud AI models are unavailable. Retry configuration later.",
    );
  const catalog = cloudModelsSchema.parse(available.data.models);
  const modelIds = catalog.map((model) => model.id);
  if (
    routes.models.some((model) => {
      if (!model.enabled) return false;
      const offered = catalog.find((item) => item.id === model.id);
      const protocol =
        model.api === "openai-responses" ? "responses" : "chat/completions";
      return !offered?.protocols.includes(protocol);
    })
  )
    throw new InstallationError(
      "invalid_configuration",
      "A selected model is no longer available from ClawScarf Cloud. Choose another model.",
    );
  const file = registrationFile + ".ai.json";
  let intent: z.infer<typeof intentSchema> = {
    installationId: id,
    url: models.cloud.url,
  };
  try {
    intent = intentSchema.parse(
      JSON.parse((await readInputFile(file, true)).toString("utf8")),
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  if (intent.installationId !== id || intent.url !== models.cloud.url)
    throw new InstallationError(
      "invalid_configuration",
      "Saved AI credentials belong to another Cloud installation.",
    );
  const persist = () => writePrivate(file, JSON.stringify(intent));
  const observed = await api.getInstallationAi({ ...request, path: { id } });
  if (!observed.data)
    throw new InstallationError(
      "unavailable",
      "Cloud AI configuration could not be read. Retry with the same directory.",
    );
  let current = configurationSchema.parse(observed.data);
  if (current.inferenceUrl !== models.cloud.url + "/v1")
    throw new InstallationError(
      "invalid_configuration",
      "Cloud returned an unexpected inference endpoint.",
    );
  if (
    !current.enabled ||
    routes.models.some(
      (model) => model.enabled && !current.modelIds.includes(model.id),
    ) ||
    intent.configuration
  ) {
    intent.configuration ??= {
      requestId: randomUUID(),
      revision: current.revision,
      enabled: true,
      modelIds,
    };
    await persist();
    const configured = await api.configureInstallationAi({
      ...request,
      path: { id },
      body: intent.configuration,
    });
    if (!configured.data)
      throw new InstallationError(
        "unavailable",
        "Cloud AI enablement was not confirmed. Retry with the same directory; the saved request will be reused.",
      );
    current = configurationSchema.parse(configured.data);
    delete intent.configuration;
    await persist();
  }
  if (!intent.credential) {
    if (current.credentialActive)
      throw new InstallationError(
        "invalid_configuration",
        "This installation already has an AI credential that is not in this settings directory. Restore the retained settings before continuing.",
      );
    intent.credential = {
      requestId: randomUUID(),
      generation: current.generation,
      secret: randomBytes(32).toString("base64url"),
    };
    await persist();
  }
  if (!intent.activeGeneration) {
    const issued = await api.rotateAiCredential({
      ...request,
      path: { id },
      body: intent.credential,
    });
    if (!issued.data)
      throw new InstallationError(
        "unavailable",
        "Cloud AI credential registration was not confirmed. Retry with the same directory; the saved secret will be reused.",
      );
    intent.activeGeneration = z
      .object({ generation: z.number().int().positive() })
      .parse(issued.data).generation;
    await persist();
  } else if (
    !current.credentialActive ||
    current.generation !== intent.activeGeneration
  ) {
    throw new InstallationError(
      "invalid_configuration",
      "This installation's AI credential was revoked or replaced. Restore or explicitly reauthorize the Cloud installation; it will not be silently rotated.",
    );
  }
  await writePrivate(
    resolve(dirname(configFile), models.upstreamEnvironmentFile),
    `${cloudAiVariable}='${intent.credential.secret}'\n`,
  );
  const balances = await api.getInstallationAllowances({
    ...request,
    path: { id },
  });
  if (!balances.data)
    throw new InstallationError(
      "unavailable",
      "AI is configured, but its available balance could not be verified. Retry configuration before starting.",
    );
  z.object({
    ai: z.object({
      available: z.number().int().nonnegative(),
      state: z.enum([
        "disabled",
        "pending",
        "available",
        "exhausted",
        "suspended",
        "unavailable",
      ]),
    }),
  }).parse(balances.data);
  return {
    url: models.cloud.url,
    installationId: id,
    accountId: registration.accountId,
    authorization: auth,
    registrationFile,
  } satisfies CloudAiSession;
}

export async function configureCloudAi(...args: Parameters<typeof configure>) {
  const [, models, , registrationFile] = args;
  if (models.mode !== "litellm" || !models.cloud) return;
  const file = registrationFile + ".ai.json";
  const unlock = await lockfile.lock(dirname(file), {
    lockfilePath: file + ".lock",
    retries: 0,
  });
  try {
    return await configure(...args);
  } finally {
    await unlock();
  }
}
