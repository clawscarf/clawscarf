import { readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { browserNodeName, pairedBrowserSchema } from "./browser-node.js";
import { browserOperatorSource } from "./browser-node-helper.js";
import { observedBrowserMachineAddresses } from "./networks.js";
import { compose } from "./compose.js";
import { ensurePrivateFile, resourceNames, type LocalState } from "./state.js";
import { LocalSetupError, run } from "./process.js";
import { verifyRuntimeBinding } from "./runtime-binding.js";

export const nodeObservationSchema = z.array(
  z.strictObject({
    nodeId: z.string(),
    admitted: z.boolean(),
    connectedAt: z.number().nullable(),
    disconnectedAt: z.number().nullable(),
  }),
);
export function browserNodeReady(
  value: z.infer<typeof nodeObservationSchema>[number],
  startedAt: number,
) {
  return (
    value.admitted &&
    value.connectedAt !== null &&
    value.connectedAt >= startedAt &&
    (value.disconnectedAt === null || value.disconnectedAt < value.connectedAt)
  );
}
async function receipt(directory: string, state: LocalState) {
  try {
    const path = join(directory, "browser-node-paired.json");
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw Error("Unsafe receipt");
    const value = pairedBrowserSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (value.ownerId !== state.ownerId) throw Error("Owner differs");
    return value;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw new LocalSetupError(
      "configuration_changed",
      "Browser pairing receipt is unsafe or belongs to another installation.",
    );
  }
}

/** Local SDK issuance needs no user session. A recorded attempt is never silently repeated. */
export async function startBrowserNode(
  directory: string,
  state: LocalState,
  signal: AbortSignal,
) {
  const browser = state.input.browser;
  if (!browser) return;
  const target = z
    .object({
      id: z.uuid(),
      name: z.string(),
      ownerId: z.literal(state.ownerId),
    })
    .parse(JSON.parse(await readFile(join(directory, "runtime.json"), "utf8")));
  const binding = await verifyRuntimeBinding(state, target);
  const source = await browserOperatorSource();
  const native = async (input: unknown): Promise<unknown> =>
    JSON.parse(
      await run(
        "docker",
        [
          "exec",
          "-i",
          "--user",
          "1000",
          "-e",
          "HOME=/home/node",
          "-e",
          "SQLITE_TMPDIR=/tmp",
          "--workdir",
          "/app",
          binding.containerId,
          "node",
          "--input-type=module",
          "-e",
          source,
        ],
        { input: JSON.stringify(input) },
      ),
    );
  const config = async (input: unknown) =>
    run(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "--network",
        "none",
        "--user",
        "0",
        "--workdir",
        "/app",
        "--mount",
        `type=volume,src=${resourceNames(state).browserNodeConfigVolume},dst=/configuration`,
        "--entrypoint",
        "node",
        browser.nodeImage,
        "--input-type=module",
        "-e",
        source,
      ],
      { input: JSON.stringify(input) },
    );
  const saved = await receipt(directory, state);
  const observe = async () =>
    nodeObservationSchema.parse(
      await native({
        command: "observe",
        name: browserNodeName(state),
        ...(saved ? { nodeId: saved.nodeId } : {}),
      }),
    );
  if (saved) {
    const observed = await observe();
    if (observed.length !== 1 || !observed[0]?.admitted)
      throw new LocalSetupError(
        "browser_unavailable",
        "The browser node's native admission was removed or changed. Startup will not re-enroll it.",
      );
  } else {
    const intent = join(directory, "browser-node-pairing-started.json");
    try {
      await lstat(intent);
      throw new LocalSetupError(
        "bootstrap_outcome_unknown",
        "Browser pairing was attempted without confirmed completion. Inspect native pairing and retained state; it will not be repeated.",
      );
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    if ((await observe()).length)
      throw new LocalSetupError(
        "configuration_changed",
        "A browser node already has the prepared name. Inspect its native identity before proceeding.",
      );
    const addresses = await observedBrowserMachineAddresses(directory, state);
    if (!addresses)
      throw new LocalSetupError(
        "network_unprepared",
        "Browser network is not prepared.",
      );
    signal.throwIfAborted();
    await ensurePrivateFile(intent, JSON.stringify({ ownerId: state.ownerId }));
    const setup = z.object({ setupCode: z.string().min(1) }).parse(
      await native({
        command: "issue",
        gatewayUrl: `wss://${addresses.ingress}:18803`,
      }),
    );
    await config({
      command: "write-code",
      ownerId: state.ownerId,
      setupCode: setup.setupCode,
    });
  }
  if (saved) await config({ command: "remove-code", ownerId: state.ownerId });
  signal.throwIfAborted();
  await compose(directory, ["up", "-d", "browser-node"]);
  const id = (await compose(directory, ["ps", "-q", "browser-node"])).trim();
  z.string()
    .regex(/^[a-f0-9]{12,64}$/)
    .parse(id);
  const startedAt = z.coerce
    .date()
    .parse(
      (
        await run("docker", ["inspect", "--format", "{{.State.StartedAt}}", id])
      ).trim(),
    )
    .getTime();
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (
      (
        await run("docker", ["inspect", "--format", "{{.State.Running}}", id])
      ).trim() !== "true"
    )
      throw new LocalSetupError(
        "browser_unavailable",
        "The browser node stopped during startup. Inspect its container logs; pairing was not repeated.",
      );
    const values = await observe();
    if (values.length > 1)
      throw new LocalSetupError(
        "configuration_changed",
        "The browser node name is ambiguous.",
      );
    const value = values[0];
    if (value && browserNodeReady(value, startedAt)) {
      if (!saved) {
        await ensurePrivateFile(
          join(directory, "browser-node-paired.json"),
          JSON.stringify({ ownerId: state.ownerId, nodeId: value.nodeId }),
        );
        await config({ command: "remove-code", ownerId: state.ownerId });
      }
      return;
    }
    await delay(1000, undefined, { signal });
  }
  throw new LocalSetupError(
    "browser_unavailable",
    "The browser node did not establish its admitted native connection before the deadline. State was retained; enrollment will not be repeated.",
  );
}
