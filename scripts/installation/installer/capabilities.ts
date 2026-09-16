import { z } from "zod";
import type { InstallationConfiguration } from "../configuration.js";
import type { Release } from "../../release/definition.js";
import type { InstallerPrompts } from "./prompts.js";
import { absolute, field, inputFile } from "./inputs.js";
import { openPack } from "../../packs/source.js";
import { connectionsBrokerUrlSchema } from "../../local/configuration.js";
import { InstallationError } from "../errors.js";

async function optionalCa(ui: InstallerPrompts) {
  return (await ui.confirm("Use a custom certificate authority?"))
    ? { caFile: await inputFile(ui, "CA certificate file") }
    : {};
}
export async function collectModels(
  ui: InstallerPrompts,
  release: Release,
): Promise<InstallationConfiguration["models"]> {
  const mode = await ui.select("Models", [
    { value: "disabled", label: "Configure later in OpenClaw" },
    { value: "external", label: "Use an existing model gateway" },
    ...(release.images.models
      ? [{ value: "litellm", label: "Run LiteLLM with this installation" }]
      : []),
  ]);
  if (mode === "disabled") return { mode };
  ui.note(
    "Use the model configuration format in the ClawScarf installation guide. Provider keys are imported from private files, never entered in this document.",
    "Model configuration",
  );
  const configurationFile = await inputFile(ui, "Model configuration file");
  if (mode === "external")
    return {
      mode,
      configurationFile,
      credentialFile: await inputFile(
        ui,
        "Scoped model gateway key file",
        true,
      ),
      ...(await optionalCa(ui)),
    };
  if (mode !== "litellm" || !release.images.models)
    throw new InstallationError(
      "invalid_configuration",
      "This release does not include the selected model service.",
    );
  return {
    mode,
    configurationFile,
    upstreamEnvironmentFile: await inputFile(
      ui,
      "Provider credentials file (.env)",
      true,
    ),
  };
}
export async function collectConnections(
  ui: InstallerPrompts,
): Promise<InstallationConfiguration["connections"]> {
  const mode = await ui.select("Connections", [
    { value: "disabled", label: "Do not enable Connections" },
    { value: "external", label: "Use an existing Connections broker" },
    { value: "local", label: "Run Connections with a Composio project" },
  ]);
  if (mode === "disabled") return { mode };
  if (mode === "external")
    return {
      mode,
      brokerUrl: await field(
        ui,
        "Connections broker URL",
        connectionsBrokerUrlSchema,
      ),
      credentialFile: await inputFile(ui, "Scoped broker key file", true),
      ...(await optionalCa(ui)),
    };
  if (mode !== "local")
    throw new InstallationError(
      "invalid_configuration",
      "Select a supported Connections mode.",
    );
  return {
    mode,
    projectId: await ui.text("Composio project ID"),
    apiKeyFile: await inputFile(ui, "Composio project key file", true),
    catalogDirectory: absolute(
      await ui.text("Prepared connector catalog directory"),
    ),
  };
}

export async function collectPacks(
  ui: InstallerPrompts,
  models: InstallationConfiguration["models"],
  connections: InstallationConfiguration["connections"],
) {
  const packs: InstallationConfiguration["packs"] = [];
  const selected = new Set<string>();
  while (
    packs.length < 32 &&
    (await ui.confirm(
      packs.length
        ? "Add another pack?"
        : "Install a pack? (experimental native Claws)",
    ))
  ) {
    const directory = absolute(await ui.text("Pack directory"));
    const pack = await openPack(directory);
    const eligible = pack.manifest.members.filter(
      (member) =>
        !selected.has(member.id) &&
        (member.requirements.model === "none" || models.mode !== "disabled") &&
        (!member.requirements.connections.length ||
          connections.mode !== "disabled"),
    );
    if (!eligible.length) {
      ui.note(
        "No unselected members meet the model and Connections prerequisites. Choose another pack or configure its prerequisites first.",
        "Pack unavailable",
      );
      continue;
    }
    const members = z
      .array(z.enum(eligible.map((member) => member.id)))
      .min(1)
      .parse(
        await ui.multiselect(
          "Pack agents",
          eligible.map((member) => ({ value: member.id, label: member.id })),
        ),
      );
    const needsConnections = eligible.some(
      (member) =>
        members.includes(member.id) && member.requirements.connections.length,
    );
    const bindingsFile = needsConnections
      ? await inputFile(ui, "Connected-account bindings file", true)
      : undefined;
    packs.push({
      directory,
      members,
      ...(bindingsFile ? { bindingsFile } : {}),
    });
    members.forEach((member) => selected.add(member));
  }
  if (!packs.length) return { packs };
  const pythonExecutable = absolute(
    await ui.text("Python executable with the pinned OpenShell SDK"),
  );
  return {
    packs,
    packOperator: { pythonExecutable, experimentalClaws: true as const },
  };
}
