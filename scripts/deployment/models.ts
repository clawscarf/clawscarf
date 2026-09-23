import { OperatorError } from "../errors.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { z } from "zod";
import type { initialConfiguration } from "../../runtime/configuration.js";
import {
  configurationSchema,
  nativeModelProvider,
  nativeModelDefaults,
} from "../models/configuration.js";
import { networkRequirementSchema } from "../packs/policy.js";
import type { LocalInput } from "./configuration.js";
import { LocalSetupError } from "./process.js";
import { ensurePrivateFile } from "./state.js";

const enabledConfiguration = configurationSchema.refine(
  (value) => value.mode !== "disabled" && value.defaultModel !== null,
  "Initial model setup requires an enabled gateway and default model.",
);
const tokenSchema = z.string().trim().min(1).max(65536);

/** Validate all optional inputs before allocating resources; never include their values in errors. */
export async function loadInitialModels(input: LocalInput["models"]) {
  if (!input) return undefined;
  try {
    const config = enabledConfiguration.parse(
      JSON.parse(await readFile(input.configurationFile, "utf8")),
    );
    if (config.mode === "disabled" || config.defaultModel === null)
      throw new OperatorError("An initial default is required.");
    const endpoint = new URL(config.baseUrl);
    if (endpoint.protocol !== "https:")
      throw new OperatorError("The runtime requires an HTTPS model gateway.");
    const network = networkRequirementSchema.parse({
      host: endpoint.hostname,
      port: Number(endpoint.port || "443"),
      protocol: "tcp",
      binary: "/usr/local/bin/node",
    });
    const token = tokenSchema.parse(
      await readFile(input.runtimeKeyFile, "utf8"),
    );
    const ca = input.caFile ? await readFile(input.caFile, "utf8") : undefined;
    // An explicitly trusted self-signed server certificate is also a valid trust anchor.
    if (ca !== undefined) new X509Certificate(ca);
    return {
      configuration: { ...config, defaultModel: config.defaultModel },
      credential: { token, ...(ca === undefined ? {} : { ca }) },
      network,
    };
  } catch {
    throw new LocalSetupError(
      "invalid_model_setup",
      "Initial models require a valid enabled model configuration with a default, an HTTPS DNS endpoint reachable from the runtime, a nonempty scoped key file and, if supplied, a valid trust certificate. Use host.docker.internal for a gateway on this workstation.",
    );
  }
}
export type InitialModels = NonNullable<
  Awaited<ReturnType<typeof loadInitialModels>>
>;

/** Only used to construct a fresh native preset, never to reconcile mutable native state. */
export function withInitialModels(
  native: ReturnType<typeof initialConfiguration>,
  models: InitialModels | undefined,
) {
  if (!models) return native;
  return {
    ...native,
    secrets: {
      providers: {
        "clawscarf-models": {
          source: "file",
          path: "/home/node/.openclaw/clawscarf-models/initial.json",
          mode: "json",
        },
      },
    },
    models: {
      ...native.models,
      providers: {
        clawscarf: {
          ...nativeModelProvider(models.configuration),
          apiKey: {
            source: "file",
            provider: "clawscarf-models",
            id: "/token",
          },
        },
      },
    },
    agents: {
      ...native.agents,
      defaults: {
        ...native.agents.defaults,
        ...nativeModelDefaults(models.configuration),
      },
    },
  };
}

export async function prepareInitialModels(
  directory: string,
  input: LocalInput["models"],
) {
  const models = await loadInitialModels(input);
  if (models)
    await ensurePrivateFile(
      join(directory, "private/model-bootstrap.json"),
      JSON.stringify(models),
    );
  return models;
}
