import { lstat, readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import ipaddr from "ipaddr.js";
import { isDeepStrictEqual } from "node:util";
import { LocalSetupError, run } from "./process.js";
import { ensurePrivateFile, resourceNames, type LocalState } from "./state.js";

const networkId = z.string().regex(/^[a-f0-9]{64}$/);
const intentSchema = z.strictObject({
  ownerId: z.uuid(),
  purpose: z.enum(["companion", "runtime", "browser", "machine"]),
  name: z.string().min(1),
});
const browserAddressSchema = z.strictObject({
  subnet: z.string(),
  address: z.ipv4(),
  gateway: z.string().optional(),
});
const receiptSchema = intentSchema
  .extend({
    id: networkId,
    isolated: browserAddressSchema.optional(),
  })
  .refine(
    (receipt) =>
      ["browser", "machine"].includes(receipt.purpose) ===
      (receipt.isolated !== undefined),
  );
type Intent = z.infer<typeof intentSchema>;
const emptyOptions = z.record(z.string(), z.never()).nullable();
const bridgeOptions = z
  .strictObject({
    "com.docker.network.enable_ipv4": z.literal("true").optional(),
    "com.docker.network.enable_ipv6": z.literal("false").optional(),
  })
  .nullable();
const inspectedSchema = z.object({
  Id: networkId,
  Name: z.string(),
  Driver: z.literal("bridge"),
  Scope: z.literal("local"),
  Internal: z.literal(false),
  Ingress: z.literal(false),
  Attachable: z.boolean(),
  EnableIPv6: z.literal(false),
  Options: bridgeOptions,
  Labels: z.record(z.string(), z.string()),
  IPAM: z.object({
    Driver: z.literal("default"),
    Options: emptyOptions,
    Config: z
      .array(z.object({ Gateway: z.string().optional() }))
      .refine((configs) =>
        configs.some((config) => config.Gateway && isIP(config.Gateway) === 4),
      ),
  }),
});

const browserInspectedSchema = inspectedSchema.extend({
  Internal: z.literal(true),
  Attachable: z.literal(false),
  Options: z.strictObject({
    "com.docker.network.enable_ipv4": z.literal("true").optional(),
    "com.docker.network.enable_ipv6": z.literal("false").optional(),
    "com.docker.network.bridge.gateway_mode_ipv4": z.literal("isolated"),
  }),
  IPAM: z.object({
    Driver: z.literal("default"),
    Options: emptyOptions,
    Config: z.tuple([
      z.strictObject({
        Subnet: z.string(),
        Gateway: z.string().optional(),
        IPRange: z.literal("").optional(),
        AuxiliaryAddresses: z.record(z.string(), z.never()).optional(),
      }),
    ]),
  }),
});
function reservedAddress(
  config: z.infer<typeof browserInspectedSchema>["IPAM"]["Config"][0],
) {
  try {
    if (!ipaddr.IPv4.isValidCIDRFourPartDecimal(config.Subnet)) changed();
    const [base, prefix] = ipaddr.IPv4.parseCIDR(config.Subnet);
    const first = ipaddr.IPv4.networkAddressFromCIDR(config.Subnet);
    const last = ipaddr.IPv4.broadcastAddressFromCIDR(config.Subnet);
    if (
      base.toString() !== first.toString() ||
      prefix > 29 ||
      first.range() !== "private" ||
      last.range() !== "private"
    )
      changed();
    // The final usable host avoids Docker's usual low-address dynamic allocation.
    const bytes = last.toByteArray();
    const end = bytes[3];
    if (end === undefined || end < 1) changed();
    bytes[3] = end - 1;
    const address = ipaddr.fromByteArray(bytes).toString();
    if (config.Gateway) {
      if (!ipaddr.IPv4.isValidFourPartDecimal(config.Gateway)) changed();
      const gateway = ipaddr.IPv4.parse(config.Gateway);
      if (
        !gateway.match([first, prefix]) ||
        [first.toString(), last.toString(), address].includes(
          gateway.toString(),
        )
      )
        changed();
    }
    return {
      subnet: config.Subnet,
      address,
      ...(config.Gateway !== undefined ? { gateway: config.Gateway } : {}),
    };
  } catch {
    changed();
  }
}

function changed(): never {
  throw new LocalSetupError(
    "network_identity_changed",
    "A required network or its private ownership record differs from this installation. Inspect it before continuing; setup will not adopt or replace it.",
  );
}
function uncertain(purpose: Intent["purpose"]): never {
  throw new LocalSetupError(
    "network_outcome_unknown",
    `Creation of this installation's ${purpose} network was attempted but its owned network is absent. Inspect Docker network capacity and this installation before continuing; setup will not automatically allocate it again.`,
  );
}
async function record(path: string): Promise<unknown> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.uid !== process.getuid?.()
    )
      changed();
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    if (error instanceof LocalSetupError) throw error;
    changed();
  }
}
function equalIntent(actual: Intent, expected: Intent) {
  return (
    actual.ownerId === expected.ownerId &&
    actual.purpose === expected.purpose &&
    actual.name === expected.name
  );
}
async function records(directory: string, intent: Intent) {
  const base = join(directory, "private", `network-${intent.purpose}`);
  const intentPath = `${base}-create.json`;
  const receiptPath = `${base}-receipt.json`;
  const pending = await record(intentPath);
  const rawReceipt = await record(receiptPath);
  if (pending !== undefined) {
    const parsed = intentSchema.safeParse(pending);
    if (!parsed.success || !equalIntent(parsed.data, intent)) changed();
  }
  let receipt: z.infer<typeof receiptSchema> | undefined;
  if (rawReceipt !== undefined) {
    const parsed = receiptSchema.safeParse(rawReceipt);
    if (
      !parsed.success ||
      !equalIntent(parsed.data, intent) ||
      pending === undefined
    )
      changed();
    receipt = parsed.data;
  }
  return { pending: pending !== undefined, receipt, intentPath, receiptPath };
}

async function observe(intent: Intent, command: typeof run) {
  try {
    const output = await command("docker", [
      "network",
      "ls",
      "--no-trunc",
      "--format",
      '{"id":{{json .ID}},"name":{{json .Name}}}',
    ]);
    const rows = output.trim()
      ? output
          .trim()
          .split("\n")
          .map((line) =>
            z
              .object({ id: networkId, name: z.string() })
              .parse(JSON.parse(line)),
          )
      : [];
    const matching = rows.filter((row) => row.name === intent.name);
    if (matching.length > 1) changed();
    const found = matching[0];
    if (!found) return undefined;
    const format =
      '{"Id":{{json .Id}},"Name":{{json .Name}},"Driver":{{json .Driver}},"Scope":{{json .Scope}},"Internal":{{json .Internal}},"Ingress":{{json .Ingress}},"Attachable":{{json .Attachable}},"EnableIPv6":{{json .EnableIPv6}},"Options":{{json .Options}},"Labels":{{json .Labels}},"IPAM":{{json .IPAM}}}';
    const raw: unknown = JSON.parse(
      await command("docker", [
        "network",
        "inspect",
        "--format",
        format,
        found.id,
      ]),
    );
    const browser = ["browser", "machine"].includes(intent.purpose)
      ? browserInspectedSchema.safeParse(raw)
      : undefined;
    const result = browser ?? inspectedSchema.safeParse(raw);
    if (!result.success) changed();
    const network = result.data;
    if (
      network.Id !== found.id ||
      network.Name !== intent.name ||
      network.Labels["clawscarf.installation"] !== intent.ownerId ||
      network.Labels["clawscarf.network-purpose"] !== intent.purpose ||
      network.Attachable !== (intent.purpose === "runtime")
    )
      changed();
    return {
      id: network.Id,
      ...(browser?.success
        ? { isolated: reservedAddress(browser.data.IPAM.Config[0]) }
        : {}),
    };
  } catch (error) {
    if (
      error instanceof LocalSetupError &&
      error.code === "network_identity_changed"
    )
      throw error;
    throw new LocalSetupError(
      "network_lookup_incomplete",
      "Docker network ownership could not be completely observed. No absence or allocation decision was made; inspect Docker before retrying.",
    );
  }
}

function intents(state: LocalState): Intent[] {
  const names = resourceNames(state);
  return [
    {
      ownerId: state.ownerId,
      purpose: "companion",
      name: `${names.project}_default`,
    },
    { ownerId: state.ownerId, purpose: "runtime", name: names.sandbox },
    ...(state.input.browser
      ? [
          {
            ownerId: state.ownerId,
            purpose: "browser" as const,
            name: `${names.project}_browser`,
          },
          {
            ownerId: state.ownerId,
            purpose: "machine" as const,
            name: `${names.project}_machine`,
          },
        ]
      : []),
  ];
}

/** Caller holds the installation lock. Reserve actual networks before volumes or services. */
export async function ensureLocalNetworks(
  directory: string,
  state: LocalState,
  command: typeof run = run,
) {
  for (const intent of intents(state)) {
    const saved = await records(directory, intent);
    let observed = await observe(intent, command);
    let id = observed?.id;
    if (!id && saved.pending) uncertain(intent.purpose);
    if (
      saved.receipt &&
      (id !== saved.receipt.id ||
        !isDeepStrictEqual(observed?.isolated, saved.receipt.isolated))
    )
      changed();
    if (id && !saved.pending) changed();
    if (!id) {
      await ensurePrivateFile(saved.intentPath, JSON.stringify(intent) + "\n");
      let returnedId: string | undefined;
      try {
        returnedId = (
          await command("docker", [
            "network",
            "create",
            "--driver",
            "bridge",
            // Docker chooses a free subnet; declaring its size permits static endpoints.
            ...(intent.purpose !== "companion"
              ? ["--subnet", "0.0.0.0/24"]
              : []),
            ...(intent.purpose === "runtime" ? ["--attachable"] : []),
            ...(["browser", "machine"].includes(intent.purpose)
              ? [
                  "--internal",
                  "--opt",
                  "com.docker.network.bridge.gateway_mode_ipv4=isolated",
                ]
              : []),
            "--label",
            `clawscarf.installation=${intent.ownerId}`,
            "--label",
            `clawscarf.network-purpose=${intent.purpose}`,
            intent.name,
          ])
        ).trim();
      } catch {
        // A lost response may follow allocation. Reconcile exact observed ownership only.
      }
      observed = await observe(intent, command);
      id = observed?.id;
      if (!id) uncertain(intent.purpose);
      if (returnedId !== undefined && returnedId !== id) changed();
    }
    if (!saved.receipt)
      await ensurePrivateFile(
        saved.receiptPath,
        JSON.stringify({
          ...intent,
          id,
          ...(observed?.isolated ? { isolated: observed.isolated } : {}),
        }) + "\n",
      );
  }
}

/** Read-only startup check: never allocate or repair a missing reservation. */
export async function verifyLocalNetworks(
  directory: string,
  state: LocalState,
  command: typeof run = run,
) {
  for (const intent of intents(state)) {
    const saved = await records(directory, intent);
    if (!saved.receipt)
      throw new LocalSetupError(
        "network_unprepared",
        "Required network reservations are not confirmed. Inspect and resume preparation before starting this installation.",
      );
    const observed = await observe(intent, command);
    if (!observed) uncertain(intent.purpose);
    if (
      observed.id !== saved.receipt.id ||
      !isDeepStrictEqual(observed.isolated, saved.receipt.isolated)
    )
      changed();
  }
}

/** Re-observe the isolated reservation before generating its static address and source ACL. */
export async function observedBrowserAddress(
  directory: string,
  state: LocalState,
  command: typeof run = run,
): Promise<string | undefined> {
  const intent = intents(state).find((value) => value.purpose === "browser");
  if (!intent) return undefined;
  const saved = await records(directory, intent);
  if (!saved.receipt)
    throw new LocalSetupError(
      "network_unprepared",
      "The browser network reservation is not confirmed. Resume preparation before configuring browser access.",
    );
  const observed = await observe(intent, command);
  if (!observed) uncertain(intent.purpose);
  if (
    observed.id !== saved.receipt.id ||
    !observed.isolated ||
    !isDeepStrictEqual(observed.isolated, saved.receipt.isolated)
  )
    changed();
  return observed.isolated.address;
}

/** Separate private bridge: only the browser node, its ingress and DNS attach. */
export async function observedBrowserMachineAddresses(
  directory: string,
  state: LocalState,
  command: typeof run = run,
) {
  const intent = intents(state).find((value) => value.purpose === "machine");
  if (!intent) return undefined;
  const saved = await records(directory, intent);
  if (!saved.receipt)
    throw new LocalSetupError(
      "network_unprepared",
      "The private browser-node network is not prepared.",
    );
  const observed = await observe(intent, command);
  if (
    !observed ||
    observed.id !== saved.receipt.id ||
    !observed.isolated ||
    !isDeepStrictEqual(observed.isolated, saved.receipt.isolated)
  )
    changed();
  const bytes = ipaddr.IPv4.parse(observed.isolated.address).toByteArray();
  const last = bytes[3];
  if (last === undefined || last < 3) changed();
  const ingress = [...bytes.slice(0, 3), last - 1].join(".");
  const dns = [...bytes.slice(0, 3), last - 2].join(".");
  if ([ingress, dns].includes(observed.isolated.gateway ?? "")) changed();
  return { node: observed.isolated.address, ingress, dns };
}

/** Stable address on the owned runtime bridge for the containerized OpenShell controller. */
export async function observedControllerAddress(
  directory: string,
  state: LocalState,
) {
  await verifyLocalNetworks(directory, state);
  const configs = z
    .array(z.object({ Subnet: z.string(), Gateway: z.string() }))
    .parse(
      JSON.parse(
        await run("docker", [
          "network",
          "inspect",
          resourceNames(state).sandbox,
          "--format",
          "{{json .IPAM.Config}}",
        ]),
      ),
    );
  const config = configs.find((item) => isIP(item.Gateway) === 4);
  if (!config) changed();
  return reservedAddress(config).address;
}
