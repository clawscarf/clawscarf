import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { LocalSetupError } from "./process.js";

export { publicWebAddresses } from "./public-addresses.js";
import { publicWebAddresses } from "./public-addresses.js";

export function publicWebPolicy(enabled: boolean) {
  return enabled
    ? {
        name: "Public web",
        endpoints: [
          { ports: [80, 443], allowed_ips: publicWebAddresses, tls: "skip" },
        ],
        binaries: [{ path: "/**" }],
      }
    : null;
}

/** OpenShell requires overlapping endpoints to have identical IP constraints. */
export function publicWebEndpointConstraints(port: number, enabled: boolean) {
  return enabled && (port === 80 || port === 443)
    ? { allowed_ips: publicWebAddresses }
    : {};
}

const managedRuleSchema = z.looseObject({
  endpoints: z.array(
    z.looseObject({
      port: z.number(),
      allowed_ips: z.array(z.string()).optional(),
    }),
  ),
});

/** Compose managed service rules with public web without broadening private access. */
export function composePublicWebRules(rules: Record<string, unknown>) {
  const enabled = rules.public_web !== undefined;
  const result = { ...rules };
  for (const key of ["connections_broker", "model_gateway"]) {
    const rule = result[key];
    if (rule === undefined) continue;
    const parsed = managedRuleSchema.safeParse(rule);
    if (!parsed.success)
      throw new LocalSetupError(
        "invalid_runtime_policy",
        "A managed service network rule has been edited into an unsupported shape. Review its policy before changing public web access.",
      );
    result[key] = {
      ...parsed.data,
      endpoints: parsed.data.endpoints.map((endpoint) => {
        if (endpoint.port !== 80 && endpoint.port !== 443) return endpoint;
        const managed = isDeepStrictEqual(
          endpoint.allowed_ips,
          publicWebAddresses,
        );
        if (enabled && endpoint.allowed_ips?.length && !managed)
          throw new LocalSetupError(
            "invalid_runtime_policy",
            "Public web overlaps a managed service's custom IP restrictions on port 80 or 443. Keep public web off or reconcile those restrictions explicitly.",
          );
        if (!enabled && !managed) return endpoint;
        const { allowed_ips: _previous, ...rest } = endpoint;
        return {
          ...rest,
          ...publicWebEndpointConstraints(endpoint.port, enabled),
        };
      }),
    };
  }
  return result;
}
