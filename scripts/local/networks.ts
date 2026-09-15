import { lstat, readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import { LocalSetupError, run } from "./process.js";
import { ensurePrivateFile, resourceNames, type LocalState } from "./state.js";

const networkId = z.string().regex(/^[a-f0-9]{64}$/);
const intentSchema = z.strictObject({
  ownerId: z.uuid(),
  purpose: z.enum(["companion", "runtime"]),
  name: z.string().min(1),
});
const receiptSchema = intentSchema.extend({ id: networkId });
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
    const result = inspectedSchema.safeParse(
      JSON.parse(
        await command("docker", [
          "network",
          "inspect",
          "--format",
          format,
          found.id,
        ]),
      ),
    );
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
    return network.Id;
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
    let id = await observe(intent, command);
    if (!id && saved.pending) uncertain(intent.purpose);
    if (saved.receipt && id !== saved.receipt.id) changed();
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
            ...(intent.purpose === "runtime" ? ["--attachable"] : []),
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
      id = await observe(intent, command);
      if (!id) uncertain(intent.purpose);
      if (returnedId !== undefined && returnedId !== id) changed();
    }
    if (!saved.receipt)
      await ensurePrivateFile(
        saved.receiptPath,
        JSON.stringify({ ...intent, id }) + "\n",
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
    const id = await observe(intent, command);
    if (!id) uncertain(intent.purpose);
    if (id !== saved.receipt.id) changed();
  }
}
