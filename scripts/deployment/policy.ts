import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { InitialModels } from "./models.js";
import type { InitialConnectionsEndpoint } from "./connections.js";
import { LocalSetupError } from "./process.js";
import { ensurePrivateFile } from "./state.js";

import { publicWebPolicy } from "./public-web.js";

export function initialRuntimePolicy(
  source: string,
  models: InitialModels | undefined,
  connections?: InitialConnectionsEndpoint,
  publicWeb = false,
) {
  const document = parseDocument(source);
  if (document.errors.length || document.warnings.length)
    throw new LocalSetupError(
      "invalid_runtime_policy",
      "The shipped runtime policy is invalid.",
    );
  const raw: unknown = document.toJS();
  const parsed = z
    .looseObject({ network_policies: z.record(z.string(), z.never()) })
    .safeParse(raw);
  if (!parsed.success)
    throw new LocalSetupError(
      "invalid_runtime_policy",
      "Initial model setup requires the shipped deny-by-default runtime policy.",
    );
  return {
    ...parsed.data,
    network_policies: {
      ...(publicWeb ? { public_web: publicWebPolicy(true) } : {}),
      ...(connections
        ? {
            connections_broker: {
              name: "Connections broker",
              endpoints: [
                {
                  host: connections.network.host,
                  port: connections.network.port,
                  tls: "skip",
                },
              ],
              binaries: [{ path: connections.network.binary }],
            },
          }
        : {}),
      ...(models
        ? {
            model_gateway: {
              name: "Model gateway",
              endpoints: [
                {
                  host: models.network.host,
                  port: models.network.port,
                  tls: "skip",
                },
              ],
              binaries: [{ path: models.network.binary }],
            },
          }
        : {}),
    },
  };
}

export async function prepareRuntimePolicy(
  directory: string,
  models: InitialModels | undefined,
  connections?: InitialConnectionsEndpoint,
  publicWeb = false,
) {
  const policy = initialRuntimePolicy(
    await readFile(
      new URL("../../deploy/openshell/policy.yaml", import.meta.url),
      "utf8",
    ),
    models,
    connections,
    publicWeb,
  );
  await ensurePrivateFile(
    join(directory, "private/runtime-policy.json"),
    JSON.stringify(policy),
  );
}
