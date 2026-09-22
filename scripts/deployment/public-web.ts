import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { LocalSetupError } from "./process.js";
import { publicWebAddresses } from "./public-addresses.js";
export { publicWebAddresses } from "./public-addresses.js";

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

const endpointSchema = z.looseObject({
  host: z.string().optional(),
  port: z.number().int().optional(),
  ports: z.array(z.number().int()).optional(),
  allowed_ips: z.array(z.string()).optional(),
});
const ruleSchema = z.looseObject({ endpoints: z.array(endpointSchema) });
export const adjustmentsSchema = z.record(
  z.string(),
  z.strictObject({
    before: z.array(endpointSchema),
    after: z.array(endpointSchema),
  }),
);
export type PolicyAdjustments = z.infer<typeof adjustmentsSchema>;
const rule = z.record(z.string(), z.unknown());
export const networkChangesSchema = z.strictObject({
  connections_broker: rule.nullable().optional(),
  public_web: rule.nullable().optional(),
});
export type NetworkChanges = z.infer<typeof networkChangesSchema>;
const ports = (endpoint: z.infer<typeof endpointSchema>) =>
  endpoint.ports?.length
    ? endpoint.ports
    : endpoint.port
      ? [endpoint.port]
      : [];
const webPort = (port: number) => port === 80 || port === 443;
function conflict(): never {
  throw new LocalSetupError(
    "invalid_runtime_policy",
    "Public web conflicts with an operator's service policy. Keep public web off or reconcile the policy explicitly; existing restrictions were not changed.",
  );
}

/** Only a recorded before/after edit can be undone. Equal address lists do not establish ownership. */
export function composeNetworkRules(
  current: Record<string, unknown>,
  changes: NetworkChanges,
  owned: PolicyAdjustments,
) {
  const rules = { ...current };
  const adjustments = { ...owned };
  const toggle = Object.hasOwn(changes, "public_web");
  const selected = new Set(Object.keys(changes));
  if (toggle) for (const key of Object.keys(adjustments)) selected.add(key);
  for (const key of selected) {
    const adjustment = adjustments[key];
    if (adjustment) {
      const actual = ruleSchema.safeParse(rules[key]);
      if (
        actual.success &&
        isDeepStrictEqual(actual.data.endpoints, adjustment.after)
      )
        rules[key] = { ...actual.data, endpoints: adjustment.before };
      delete adjustments[key];
    }
  }
  for (const [key, replacement] of Object.entries(changes)) {
    if (replacement === null) {
      delete rules[key];
      continue;
    }
    if (key === "connections_broker" && rules[key]) {
      const before = ruleSchema.parse(rules[key]);
      const after = ruleSchema.parse(replacement);
      // Selected service updates retain explicit address restrictions on the same endpoint.
      for (const endpoint of before.endpoints.filter(
        (entry) => entry.allowed_ips?.length,
      )) {
        const target = after.endpoints.find(
          (entry) =>
            entry.host === endpoint.host &&
            isDeepStrictEqual(ports(entry), ports(endpoint)),
        );
        if (!target) conflict();
        target.allowed_ips = endpoint.allowed_ips;
      }
      rules[key] = after;
    } else rules[key] = replacement;
  }
  if (rules.public_web !== undefined) {
    for (const key of ["connections_broker", "model_gateway"]) {
      if (!toggle && !selected.has(key)) continue;
      if (rules[key] === undefined) continue;
      const parsed = ruleSchema.parse(rules[key]);
      const after = parsed.endpoints.flatMap((endpoint) => {
        const covered = ports(endpoint).filter(webPort);
        if (!covered.length) return [endpoint];
        if (endpoint.allowed_ips?.length) {
          if (
            !isDeepStrictEqual(
              [...endpoint.allowed_ips].sort(),
              [...publicWebAddresses].sort(),
            )
          )
            conflict();
          return [endpoint];
        }
        const other = ports(endpoint).filter((port) => !webPort(port));
        if (!other.length)
          return [{ ...endpoint, allowed_ips: publicWebAddresses }];
        const { port: _port, ports: _ports, ...rest } = endpoint;
        return [
          { ...rest, ports: other },
          { ...rest, ports: covered, allowed_ips: publicWebAddresses },
        ];
      });
      if (!isDeepStrictEqual(parsed.endpoints, after)) {
        adjustments[key] = { before: parsed.endpoints, after };
        rules[key] = { ...parsed, endpoints: after };
      }
    }
    // The wildcard overlaps every host on these ports. Never rewrite unrelated rules to make it fit.
    if (toggle || selected.has("connections_broker")) {
      for (const [key, value] of Object.entries(rules)) {
        if (!toggle && key !== "connections_broker") continue;
        const parsed = ruleSchema.safeParse(value);
        if (!parsed.success) continue;
        for (const endpoint of parsed.data.endpoints) {
          if (!ports(endpoint).some(webPort)) continue;
          if (
            endpoint.tls !== "skip" ||
            endpoint.protocol === "tcp" ||
            !isDeepStrictEqual(
              [...(endpoint.allowed_ips ?? [])].sort(),
              [...publicWebAddresses].sort(),
            )
          )
            conflict();
        }
      }
    }
  }
  return { rules, adjustments };
}
