import { isAbsolute, normalize } from "node:path/posix";
import { z } from "zod";

const host = z
  .string()
  .max(253)
  .regex(
    /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/,
  )
  .refine(
    (value) =>
      !/^[0-9.]+$/.test(value) &&
      value.split(".").every((label) => label.length <= 63),
    "Use an exact DNS hostname, not an IP address.",
  );
const binary = z
  .string()
  .refine(
    (value) =>
      isAbsolute(value) &&
      normalize(value) === value &&
      !/[\s*?[\]{}]/.test(value) &&
      Array.from(value).every((character) => character.charCodeAt(0) >= 32),
    "Use an exact canonical executable path inside the runtime.",
  );
export const networkRequirementSchema = z.strictObject({
  binary,
  host,
  port: z.number().int().min(1).max(65535),
  protocol: z.literal("tcp"),
});
export type NetworkRequirement = z.infer<typeof networkRequirementSchema>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => BigInt(value) <= 18446744073709551615n);
export const policyProofSchema = z.strictObject({
  sandboxId: z.string().min(1),
  version: z.number().int().positive(),
  hash,
  configRevision: revision,
});
export type PolicyProof = z.infer<typeof policyProofSchema>;
export class PolicyVerificationError extends Error {
  constructor(
    readonly code:
      | "policy_unverified"
      | "policy_changed"
      | "policy_unsupported"
      | "network_not_permitted",
    message: string,
  ) {
    super(message);
    this.name = "PolicyVerificationError";
  }
}
type Target = {
  sandbox: string;
  sandboxId: string;
  run: (args: readonly string[]) => Promise<string>;
};
const sandboxSchema = z.object({
  id: z.string(),
  name: z.string(),
  phase: z.literal("Ready"),
  current_policy_version: z.number().int().positive(),
});
const effectiveSchema = z.object({
  sandbox: z.string(),
  version: z.number().int().positive(),
  hash,
  config_revision: revision,
  status: z.literal("effective"),
  policy_source: z.string(),
  policy: z.object({
    network_policies: z.record(z.string(), z.unknown()).default({}),
    network_middlewares: z.record(z.string(), z.unknown()).default({}),
  }),
});
const loadedSchema = z.object({
  sandbox: z.string(),
  version: z.number().int().positive(),
  active_version: z.number().int().positive(),
  hash,
  status: z.string(),
  loaded_at_ms: z.number().int().positive().optional(),
  load_error: z.string().optional(),
});
const entrySchema = z.strictObject({
  name: z.string().optional(),
  endpoints: z.array(z.record(z.string(), z.unknown())),
  binaries: z.array(z.strictObject({ path: z.string() })),
});
const endpointSchema = z.strictObject({
  host,
  port: z.number().int().min(1).max(65535),
  protocol: z.literal("tcp"),
  enforcement: z.literal("enforce").optional(),
});

/** JSON.parse's source context preserves the CLI's uint64 fingerprint exactly. */
function parse(raw: string): unknown {
  return JSON.parse(
    raw,
    (key: string, value: unknown, context?: { source?: string }) => {
      if (key !== "config_revision") return value;
      if (
        typeof value !== "number" ||
        !context?.source ||
        !/^\d+$/.test(context.source)
      )
        throw new PolicyVerificationError(
          "policy_unverified",
          "OpenShell returned an invalid config revision.",
        );
      return context.source;
    },
  );
}
function verifyCoverage(
  policy: z.infer<typeof effectiveSchema>["policy"],
  requirements: readonly NetworkRequirement[],
) {
  if (Object.keys(policy.network_middlewares).length)
    throw new PolicyVerificationError(
      "policy_unsupported",
      "This pack verifier cannot qualify middleware-dependent network policy. Review the native policy explicitly.",
    );
  const entries = Object.values(policy.network_policies).map((value) => {
    const result = entrySchema.safeParse(value);
    if (!result.success)
      throw new PolicyVerificationError(
        "policy_unsupported",
        "Unsupported network rule shape; this verifier supports exact executable and unconditional TCP grants only.",
      );
    return result.data;
  });
  for (const requirement of requirements) {
    let permitted = false;
    for (const entry of entries) {
      for (const endpoint of entry.endpoints) {
        if (
          typeof endpoint.host !== "string" ||
          /[*?[\]{}]/.test(endpoint.host)
        )
          throw new PolicyVerificationError(
            "policy_unsupported",
            "Hostless and wildcard endpoint rules require native policy review; this verifier does not infer their coverage.",
          );
        if (endpoint.host !== requirement.host) continue;
        if (entry.binaries.some((value) => /[*?[\]{}]/.test(value.path)))
          throw new PolicyVerificationError(
            "policy_unsupported",
            "Wildcard executable rules require native policy review. Use a canonical executable requirement.",
          );
        if (!entry.binaries.some((value) => value.path === requirement.binary))
          continue;
        if (endpoint.protocol === undefined)
          throw new PolicyVerificationError(
            "policy_unsupported",
            `Policy for ${requirement.host} permits explicit-proxy passthrough, not native TCP. This TCP requirement needs an explicit protocol: tcp grant; review the required transport without changing policy automatically.`,
          );
        const result = endpointSchema.safeParse(endpoint);
        if (!result.success)
          throw new PolicyVerificationError(
            "policy_unsupported",
            `Cannot qualify conditional, audited or non-TCP policy for ${requirement.host}; this verifier does not evaluate L7 rules.`,
          );
        if (result.data.port === requirement.port) permitted = true;
      }
    }
    if (!permitted)
      throw new PolicyVerificationError(
        "network_not_permitted",
        `No exact loaded TCP grant for ${requirement.binary} to ${requirement.host}:${String(requirement.port)}.`,
      );
  }
}

/** Observes loaded policy coverage, never changes policy or claims a successful connection. */
export async function verifyNetworkPolicy(
  requirements: readonly NetworkRequirement[],
  target: Target,
): Promise<PolicyProof | null> {
  if (!requirements.length) return null;
  const parsed = z.array(networkRequirementSchema).parse(requirements);
  const readSandbox = async () =>
    sandboxSchema.parse(
      parse(
        await target.run([
          "sandbox",
          "get",
          target.sandbox,
          "--output",
          "json",
        ]),
      ),
    );
  const readEffective = async () =>
    effectiveSchema.parse(
      parse(
        await target.run([
          "policy",
          "get",
          target.sandbox,
          "--full",
          "--output",
          "json",
        ]),
      ),
    );
  const identity = await readSandbox();
  if (identity.id !== target.sandboxId || identity.name !== target.sandbox)
    throw new PolicyVerificationError(
      "policy_changed",
      "The target sandbox was replaced; create a new pack preview.",
    );
  const effective = await readEffective();
  if (
    effective.sandbox !== target.sandbox ||
    effective.policy_source !== "sandbox"
  )
    throw new PolicyVerificationError(
      "policy_unsupported",
      "Global policy requires a per-sandbox effective-load acknowledgment this verifier cannot obtain. Use explicit native review.",
    );
  const loaded = loadedSchema.parse(
    parse(
      await target.run([
        "policy",
        "get",
        target.sandbox,
        "--rev",
        String(effective.version),
        "--output",
        "json",
      ]),
    ),
  );
  if (
    loaded.sandbox !== target.sandbox ||
    loaded.status !== "loaded" ||
    !loaded.loaded_at_ms ||
    loaded.load_error ||
    loaded.version !== effective.version ||
    loaded.active_version !== effective.version ||
    identity.current_policy_version !== effective.version
  )
    throw new PolicyVerificationError(
      "policy_unverified",
      "The requested policy is not confirmed loaded. Wait for native policy activation, then retry the preview.",
    );
  if (loaded.hash !== effective.hash)
    throw new PolicyVerificationError(
      "policy_unsupported",
      "Effective policy differs from the acknowledged revision, including possible provider composition. Native review is required.",
    );
  verifyCoverage(effective.policy, parsed);
  const after = await readEffective();
  const finalIdentity = await readSandbox();
  if (
    finalIdentity.id !== identity.id ||
    finalIdentity.name !== identity.name ||
    finalIdentity.current_policy_version !== loaded.version ||
    after.hash !== effective.hash ||
    after.version !== effective.version ||
    after.config_revision !== effective.config_revision ||
    after.policy_source !== effective.policy_source ||
    after.sandbox !== effective.sandbox
  )
    throw new PolicyVerificationError(
      "policy_changed",
      "Runtime policy changed during verification; create a new pack preview.",
    );
  return {
    sandboxId: identity.id,
    version: loaded.version,
    hash: effective.hash,
    configRevision: effective.config_revision,
  };
}
