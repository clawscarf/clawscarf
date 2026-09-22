import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { InitialModels } from "./models.js";
import type { InitialConnectionsEndpoint } from "./connections.js";
import { LocalSetupError } from "./process.js";
import { ensurePrivateFile } from "./state.js";

import { publicWebPolicy, composeNetworkRules } from "./public-web.js";

export function serviceNetworkRule(
  name: string,
  network?: { host: string; port: number; binary: string },
) {
  return network
    ? {
        name,
        endpoints: [{ host: network.host, port: network.port, tls: "skip" }],
        binaries: [{ path: network.binary }],
      }
    : null;
}

export function initialRuntimePolicy(
  source: string,
  models: InitialModels | undefined,
  connections?: InitialConnectionsEndpoint,
  publicWeb = false,
  telemetryHost?: string,
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
  const analytics = telemetryHost ? new URL(telemetryHost) : undefined;
  const services = {
    ...(analytics
      ? {
          product_analytics: serviceNetworkRule("Product analytics", {
            host: analytics.hostname,
            port: Number(analytics.port || 443),
            binary: "/usr/local/bin/node",
          }),
        }
      : {}),
    ...(models
      ? { model_gateway: serviceNetworkRule("Model gateway", models.network) }
      : {}),
    ...(connections
      ? {
          connections_broker: serviceNetworkRule(
            "Connections broker",
            connections.network,
          ),
        }
      : {}),
  };
  return {
    ...parsed.data,
    network_policies: composeNetworkRules(
      services,
      { public_web: publicWebPolicy(publicWeb) },
      {},
    ).rules,
  };
}

export async function prepareRuntimePolicy(
  directory: string,
  ownerId: string,
  models: InitialModels | undefined,
  connections?: InitialConnectionsEndpoint,
  publicWeb = false,
  telemetryHost?: string,
) {
  const policy = initialRuntimePolicy(
    await readFile(
      new URL("../../deploy/openshell/policy.yaml", import.meta.url),
      "utf8",
    ),
    models,
    connections,
    false,
    telemetryHost,
  );
  const composed = composeNetworkRules(
    policy.network_policies,
    { public_web: publicWebPolicy(publicWeb) },
    {},
  );
  await ensurePrivateFile(
    join(directory, "private/network-policy-adjustments.json"),
    JSON.stringify({ ownerId, rules: composed.adjustments }),
  );
  policy.network_policies = composed.rules;
  await ensurePrivateFile(
    join(directory, "private/runtime-policy.json"),
    JSON.stringify(policy),
  );
}
