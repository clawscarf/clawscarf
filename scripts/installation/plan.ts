import { dirname, join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { prepareLocal } from "../deployment/prepare.js";
import {
  readState,
  ensurePrivateFile,
  withInstallationLock,
} from "../deployment/state.js";
import { fingerprint, readJson } from "./files.js";
import { InstallationError } from "./errors.js";
import { allocatePorts, resolveInstallation } from "./resolve.js";
import { resolveConfigurationInputs } from "./configure.js";
import { installationSchema } from "./configuration.js";

export const planSchema = z.strictObject({
  schemaVersion: z.literal(1),
  stateDirectory: z.string(),
  fingerprint: z.string(),
  observedState: z.string().nullable(),
  internalPorts: z.array(z.number().int().min(1024).max(65535)).length(8),
  action: z.enum(["prepare", "resume"]),
  release: z.string(),
  browser: z.boolean(),
  capabilities: z.strictObject({
    models: z.enum(["external", "litellm"]),
    connections: z.enum(["disabled", "hosted"]),
    packs: z.array(
      z.strictObject({ directory: z.string(), members: z.array(z.string()) }),
    ),
  }),
});
async function observation(directory: string) {
  try {
    await readState(directory);
    return fingerprint(await readFile(join(directory, "installation.json")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}
export async function planInstallation(configFile: string) {
  const config = installationSchema.parse(await readJson(configFile));
  const directory = resolve(
    dirname(resolve(configFile)),
    config.stateDirectory,
  );
  const observed = await observation(directory);
  const state = observed ? await readState(directory) : null;
  const input = state?.input;
  const internalPorts = input
    ? [
        input.ports.controller,
        input.ports.management,
        input.ports.native,
        input.ports.nativeWidgets,
        input.ports.database,
        input.execution?.port ?? 0,
        input.browser?.port ?? 65534,
        input.modelGateway?.port ?? 65533,
      ]
    : await allocatePorts();
  const resolved = await resolveInstallation(configFile, internalPorts);
  if (state && !isDeepStrictEqual(state.input, resolved.input))
    throw new InstallationError(
      "change_unsupported",
      "This change requires an explicit configuration or upgrade operation. Prepare never replaces retained settings.",
    );
  await verifyRetainedInputs(directory, resolved.fingerprint);
  return planSchema.parse({
    schemaVersion: 1,
    stateDirectory: directory,
    fingerprint: resolved.fingerprint,
    observedState: observed,
    internalPorts,
    action: state ? "resume" : "prepare",
    release: resolved.release.version,
    browser: config.browser.enabled,
    capabilities: {
      models: config.models.mode,
      connections: config.connections.mode,
      packs: resolved.packSelection.packs.map(({ directory, members }) => ({
        directory,
        members,
      })),
    },
  });
}
export async function applyInstallation(configFile: string, planFile: string) {
  const plan = planSchema.parse(await readJson(planFile));
  const resolved = await resolveInstallation(configFile, plan.internalPorts);
  if (
    resolved.fingerprint !== plan.fingerprint ||
    resolved.stateDirectory !== plan.stateDirectory
  )
    throw new InstallationError(
      "stale_plan",
      "Configuration or release inputs changed. Create a new plan.",
    );
  return withInstallationLock(plan.stateDirectory, async () => {
    if ((await observation(plan.stateDirectory)) !== plan.observedState)
      throw new InstallationError(
        "stale_plan",
        "Installation state changed. Create a new plan before resuming.",
      );
    await verifyRetainedInputs(resolved.stateDirectory, resolved.fingerprint);
    // The existing operator records identity before effects and verifies retained resource ownership.
    await prepareLocal(resolved.stateDirectory, resolved.input, {
      inputFingerprint: resolved.fingerprint,
      ...(resolved.config.connections.mode === "disabled"
        ? {}
        : {
            connections: resolved.connectorCredentialFile
              ? { credentialFile: resolved.connectorCredentialFile }
              : {},
          }),
    });
    await ensurePrivateFile(
      join(resolved.stateDirectory, "release.json"),
      JSON.stringify(resolved.release, null, 2),
    );
    await ensurePrivateFile(
      join(resolved.stateDirectory, "packs.json"),
      JSON.stringify(resolved.packSelection),
    );
    await ensurePrivateFile(
      join(resolved.stateDirectory, "settings.json"),
      JSON.stringify(
        {
          ...resolveConfigurationInputs(
            resolved.config,
            dirname(resolve(configFile)),
          ),
          stateDirectory: resolved.stateDirectory,
        },
        null,
        2,
      ),
    );
    return {
      state: "prepared",
      directory: resolved.stateDirectory,
      release: resolved.release.version,
    };
  });
}

async function verifyRetainedInputs(directory: string, expected: string) {
  try {
    if ((await readFile(join(directory, "inputs.sha256"), "utf8")) !== expected)
      throw new InstallationError(
        "change_unsupported",
        "Prepared capability inputs changed. Use the explicit model, Connections or pack operator; prepare does not reapply or rotate native settings.",
      );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
}
