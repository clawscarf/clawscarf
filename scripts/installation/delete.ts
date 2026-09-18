import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { run } from "../deployment/process.js";
import {
  readInstallationIdentity,
  resourceNames,
  withInstallationLock,
} from "../deployment/state.js";
import { InstallationError } from "./errors.js";
import {
  InstallerCancelled,
  SectionCancelled,
  terminalPrompts,
  type InstallerPrompts,
} from "./installer/prompts.js";

type DeleteOptions = {
  confirmDelete?: string;
  acceptDataLoss?: boolean;
  json?: boolean;
};
export async function confirmDeletion(
  directory: string,
  options: DeleteOptions,
  prompts: Pick<InstallerPrompts, "confirm"> = terminalPrompts,
) {
  if (options.confirmDelete !== undefined || options.acceptDataLoss) {
    if (options.confirmDelete !== resolve(directory) || !options.acceptDataLoss)
      throw new InstallationError(
        "invalid_configuration",
        "Unattended deletion requires --confirm-delete with the exact absolute installation directory and --accept-data-loss.",
      );
    return;
  }
  if (
    options.json ||
    (prompts === terminalPrompts &&
      (!process.stdin.isTTY || !process.stdout.isTTY))
  )
    throw new InstallationError(
      "invalid_configuration",
      "Deletion requires two confirmations in a terminal, or --confirm-delete <absolute-installation-directory> --accept-data-loss.",
    );
  try {
    if (
      !(await prompts.confirm(
        `Stop and delete the installation at ${directory}?`,
        false,
      )) ||
      !(await prompts.confirm(
        "Permanently delete ALL installation data, including chats, files, accounts and settings stored in Docker? This cannot be undone.",
        false,
      ))
    )
      throw new InstallerCancelled();
  } catch (error) {
    if (error instanceof SectionCancelled) throw new InstallerCancelled();
    throw error;
  }
}

/** Delete exact owned resources, including failed/partially started installations. Never prune. */
export async function deleteInstallation(
  directory: string,
  signal?: AbortSignal,
) {
  directory = resolve(directory);
  return withInstallationLock(directory, async () => {
    const state = await readInstallationIdentity(directory);
    const names = resourceNames(state);
    const list = async (
      kind: "container" | "volume" | "network",
      filter: string,
    ) =>
      (
        await run("docker", [
          kind,
          "ls",
          ...(kind === "container" ? ["--all"] : []),
          "--quiet",
          "--filter",
          `label=${filter}`,
        ])
      )
        .trim()
        .split("\n")
        .filter(Boolean);
    const label = `clawscarf.installation=${state.ownerId}`;
    const managed = await list("container", label);
    const containers = [
      ...new Set([
        ...managed,
        ...(await list(
          "container",
          `com.docker.compose.project=${names.project}`,
        )),
        ...(await list(
          "container",
          `openshell.ai/sandbox-namespace=${names.sandbox}`,
        )),
      ]),
    ];
    // OpenShell carries its namespace rather than our installation label into Docker.
    // Confirm its controller mount as well, before stopping or deleting anything.
    if (containers.length) {
      const inspected = z
        .array(
          z.object({
            Config: z.object({
              Labels: z.record(z.string(), z.string()).nullable(),
            }),
            Mounts: z.array(
              z.object({
                Type: z.string(),
                Source: z.string(),
                Destination: z.string(),
              }),
            ),
          }),
        )
        .parse(
          JSON.parse(
            await run("docker", [
              "container",
              "inspect",
              "--format",
              '{"Config":{"Labels":{{json .Config.Labels}}},"Mounts":{{json .Mounts}}}',
              ...containers,
            ]).then((output) => `[${output.trim().split("\n").join(",")}]`),
          ),
        );
      for (const container of inspected) {
        const labels = container.Config.Labels ?? {};
        if (labels["clawscarf.installation"] === state.ownerId) continue;
        if (
          labels["openshell.ai/managed-by"] !== "openshell" ||
          labels["openshell.ai/sandbox-namespace"] !== names.sandbox ||
          !container.Mounts.some(
            (mount) =>
              mount.Type === "bind" &&
              mount.Source === join(directory, "controller/tls/ca.crt") &&
              mount.Destination === "/etc/openshell/tls/client/ca.crt",
          )
        )
          throw new InstallationError(
            "invalid_configuration",
            "A matching Docker container does not belong to this installation. Nothing was deleted.",
          );
      }
    }
    const volumes = await list("volume", label);
    const networks = await list("network", label);
    signal?.throwIfAborted();
    // Prevent restart after partial deletion; retain ownership records so deletion can resume.
    await rm(join(directory, "prepared.json"), { force: true });
    if (managed.length)
      await run("docker", ["container", "stop", "--time", "20", ...managed], {
        timeout: 120_000,
      });
    signal?.throwIfAborted();
    if (containers.length) {
      await run(
        "docker",
        ["container", "stop", "--time", "20", ...containers],
        { timeout: 120_000 },
      );
      signal?.throwIfAborted();
      await run("docker", ["container", "rm", ...containers]);
    }
    signal?.throwIfAborted();
    if (volumes.length) await run("docker", ["volume", "rm", ...volumes]);
    signal?.throwIfAborted();
    if (networks.length) await run("docker", ["network", "rm", ...networks]);
    return { state: "deleted" as const, stateDirectory: directory };
  });
}
