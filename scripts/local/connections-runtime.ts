import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  connectionsConfigurationInputSchema,
  connectionsConfigurationResultSchema,
} from "../../runtime/connections-configuration.js";
import { readInitialConnectionsEndpoint } from "./connections.js";
import {
  readState,
  resourceNames,
  withLocalLock,
  writePrivate,
} from "./state.js";
import { runtimeManager } from "./runtime.js";
import { verifyRuntimeBinding } from "./runtime-binding.js";
import { requireNoUpgrade } from "./upgrade-state.js";
import { LocalSetupError, run } from "./process.js";

const changeSchema = z.strictObject({
  ownerId: z.uuid(),
  id: z.uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  state: z.enum(["pending", "complete"]),
});
const desiredSchema = z.strictObject({
  ownerId: z.uuid(),
  brokerUrl: z.url(),
  credential: z.strictObject({
    token: z.string().min(1),
    ca: z.string().optional(),
  }),
});

async function readOptional(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readPrivateText(path, 1024 * 1024));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

export async function requireNoConnectionsChange(
  directory: string,
  ownerId: string,
) {
  const value = await readOptional(
    join(directory, "connections-configuration.json"),
  );
  if (value === undefined) return;
  const change = changeSchema.parse(value);
  if (change.ownerId !== ownerId || change.state !== "complete")
    throw new LocalSetupError(
      "connections_configuration_pending",
      "Connections configuration is unconfirmed. Keep the installation stopped, inspect with connections observe, then explicitly configure it before starting.",
    );
}

async function readPrivateText(path: string, maximumBytes: number) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await file.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== process.getuid?.() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size > maximumBytes
    )
      throw Error("Invalid private credential file.");
    const bytes = await file.readFile();
    if (bytes.length > maximumBytes)
      throw Error("Invalid private credential file.");
    return bytes.toString("utf8");
  } finally {
    await file.close();
  }
}

/** Explicit stopped-runtime configuration. Ordinary startup never issues or reapplies credentials. */
export async function operateConnectionsRuntime(
  directoryInput: string,
  options: { kind: "observe" } | { kind: "configure"; credentialFile: string },
  command: typeof run = run,
) {
  const directory = resolve(directoryInput);
  await readState(directory);
  return withLocalLock(directory, async () => {
    const state = await readState(directory);
    await requireNoUpgrade(directory);
    const endpoint = await readInitialConnectionsEndpoint(directory);
    if (!endpoint)
      throw new LocalSetupError(
        "invalid_connections_setup",
        "This installation has no configured Connections broker.",
      );
    if (Object.keys(process.env).some((key) => key.startsWith("OPENSHELL_")))
      throw new LocalSetupError(
        "configuration_changed",
        "Unset OPENSHELL_* overrides before configuring this installation.",
      );
    const names = resourceNames(state);
    const controller = join(directory, "controller");
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: join(controller, "config"),
      XDG_STATE_HOME: join(controller, "state"),
      XDG_DATA_HOME: join(controller, "data"),
    };
    const running = await command("docker", [
      "container",
      "ls",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${names.project}`,
      "--filter",
      "label=com.docker.compose.service=companion",
    ]);
    if (running.trim())
      throw new LocalSetupError(
        "connections_configuration_refused",
        "Stop the installation and its companion; start only its private controller before configuring Connections.",
      );
    const manager = runtimeManager(directory, state, env, command);
    const records = await manager.recorded();
    const target = await manager.observe();
    if (records.receipt) {
      if (
        !target ||
        target.id !== records.receipt.id ||
        target.phase !== "Stopped"
      )
        throw new LocalSetupError(
          "connections_configuration_refused",
          "Connections configuration requires this installation's recorded runtime to be Stopped.",
        );
      await verifyRuntimeBinding(state, target, command);
    } else if (records.pending || target) {
      throw new LocalSetupError(
        "connections_configuration_refused",
        "Resolve the unconfirmed runtime allocation before configuring Connections.",
      );
    }
    const volume = z
      .object({
        Name: z.literal(names.volume),
        Labels: z.record(z.string(), z.string()),
      })
      .parse(
        JSON.parse(
          await command("docker", [
            "volume",
            "inspect",
            "--format",
            '{"Name":{{json .Name}},"Labels":{{json .Labels}}}',
            names.volume,
          ]),
        ),
      );
    if (volume.Labels["clawscarf.installation"] !== state.ownerId)
      throw new LocalSetupError(
        "connections_configuration_refused",
        "The native home volume does not belong to this installation.",
      );
    if (
      (
        await command("docker", [
          "container",
          "ls",
          "--quiet",
          "--filter",
          `volume=${names.volume}`,
        ])
      ).trim()
    )
      throw new LocalSetupError(
        "connections_configuration_refused",
        "A running container is using the native home volume. Stop it before configuring Connections.",
      );
    const identity = z
      .object({ serverId: z.uuid() })
      .parse(
        JSON.parse(await readFile(join(directory, "identity.json"), "utf8")),
      );
    const desiredPath = join(directory, "private/connections-runtime.json");
    const rawDesired =
      options.kind === "observe" ? await readOptional(desiredPath) : undefined;
    const desired =
      rawDesired === undefined ? undefined : desiredSchema.parse(rawDesired);
    if (
      desired &&
      (desired.ownerId !== state.ownerId ||
        desired.brokerUrl !== endpoint.brokerUrl)
    )
      throw new LocalSetupError(
        "configuration_changed",
        "The retained Connections credential belongs to different installation settings.",
      );
    const credential =
      options.kind === "configure"
        ? {
            token: (
              await readPrivateText(resolve(options.credentialFile), 4096)
            ).trim(),
            ...(endpoint.ca ? { ca: endpoint.ca } : {}),
          }
        : desired?.credential;
    const request = connectionsConfigurationInputSchema.parse({
      kind: options.kind,
      ownerId: state.ownerId,
      serverId: identity.serverId,
      brokerUrl: endpoint.brokerUrl,
      ...(credential ? { credential } : {}),
    });
    const changePath = join(directory, "connections-configuration.json");
    const change = {
      ownerId: state.ownerId,
      id: randomUUID(),
      digest: createHash("sha256")
        .update(JSON.stringify(request))
        .digest("hex"),
      state: "pending" as const,
    };
    if (options.kind === "configure") {
      await writePrivate(changePath, JSON.stringify(change));
      await writePrivate(
        desiredPath,
        JSON.stringify({
          ownerId: state.ownerId,
          brokerUrl: endpoint.brokerUrl,
          credential,
        }),
      );
    }
    try {
      const result = connectionsConfigurationResultSchema.parse(
        JSON.parse(
          await command(
            "docker",
            [
              "run",
              "--rm",
              "-i",
              "--pull",
              "never",
              "--network",
              "none",
              "--read-only",
              "--cap-drop",
              "ALL",
              "--security-opt",
              "no-new-privileges:true",
              "--user",
              "1000:1000",
              "--tmpfs",
              "/tmp:rw,nosuid,nodev,size=64m",
              "--mount",
              `type=volume,source=${names.volume},target=/home/node,volume-nocopy${options.kind === "observe" ? ",readonly" : ""}`,
              "--entrypoint",
              "node",
              state.input.runtimeImage,
              "/app/clawscarf/configure-connections-main.js",
            ],
            { input: JSON.stringify(request), timeout: 60_000 },
          ),
        ),
      );
      if (options.kind === "configure") {
        if (result.state !== "configured" || result.credentialMatches !== true)
          throw Error("Connections configuration was not verified.");
        await writePrivate(
          changePath,
          JSON.stringify({ ...change, state: "complete" }),
        );
      }
      return { ...result, restartRequired: options.kind === "configure" };
    } catch {
      throw new LocalSetupError(
        options.kind === "configure"
          ? "connections_configuration_pending"
          : "connections_configuration_unavailable",
        options.kind === "configure"
          ? "Connections configuration did not confirm completion. Keep the installation stopped and inspect with connections observe before explicitly reapplying."
          : "Connections configuration could not be read. Inspect the private runtime settings and credential files; no change was requested.",
      );
    }
  });
}
