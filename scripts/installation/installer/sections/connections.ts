import type { InstallationConfiguration } from "../../configuration.js";
import type { InstallerPrompts } from "../prompts.js";
import { field } from "../inputs.js";
import { connectionsBrokerUrlSchema } from "../../../deployment/configuration.js";
import { InstallationError } from "../../errors.js";
import { optionalCa } from "./certificates.js";
import type { SetupInputs } from "../../save.js";
import { secretInput } from "../secrets.js";

export async function collectConnections(
  ui: InstallerPrompts,
  current: InstallationConfiguration["connections"],
  catalogDirectory?: string,
): Promise<InstallationConfiguration["connections"]> {
  const enabled = await ui.select(
    "Connections",
    [
      { value: "off", label: "Off" },
      { value: "on", label: "On" },
    ],
    current.mode === "disabled" ? "off" : "on",
  );
  if (enabled === "off") return { mode: "disabled" };
  const mode = await ui.select(
    "Connections backend",
    [
      { value: "local", label: "Composio project" },
      { value: "external", label: "Existing Connections broker" },
    ],
    current.mode === "disabled" ? "local" : current.mode,
  );
  if (mode === "external") {
    const brokerUrl = await field(
      ui,
      "Connections broker URL",
      connectionsBrokerUrlSchema,
      current.mode === "external" ? current.brokerUrl : undefined,
    );
    return {
      mode,
      brokerUrl,
      credentialFile:
        current.mode === "external" && current.brokerUrl === brokerUrl
          ? current.credentialFile
          : "",
      ...(await optionalCa(
        ui,
        current.mode === "external" ? current.caFile : undefined,
      )),
    };
  }
  if (!catalogDirectory && current.mode !== "local")
    throw new InstallationError(
      "unavailable",
      "This release does not include the Connections catalog. Choose a release with Connections, or use an existing broker.",
    );
  const projectId = await ui.text(
    "Composio project ID",
    current.mode === "local" ? current.projectId : undefined,
  );
  return {
    mode: "local",
    projectId,
    apiKeyFile:
      current.mode === "local" && current.projectId === projectId
        ? current.apiKeyFile
        : "",
    catalogDirectory:
      catalogDirectory ??
      (current.mode === "local" ? current.catalogDirectory : ""),
  };
}

export async function collectConnectionCredentials(
  ui: InstallerPrompts,
  current: InstallationConfiguration["connections"],
  inputs: SetupInputs,
) {
  if (current.mode === "disabled") return current;
  if (current.mode === "local")
    return current.apiKeyFile
      ? current
      : {
          ...current,
          apiKeyFile: await secretInput(
            ui,
            inputs,
            `Composio project key (${current.projectId})`,
            "connections-key",
          ),
        };
  return current.credentialFile
    ? current
    : {
        ...current,
        credentialFile: await secretInput(
          ui,
          inputs,
          "Connections broker key",
          "broker-key",
        ),
      };
}
