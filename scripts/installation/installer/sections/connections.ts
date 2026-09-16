import type { InstallationConfiguration } from "../../configuration.js";
import type { InstallerPrompts } from "../prompts.js";
import { absolute, field } from "../inputs.js";
import { connectionsBrokerUrlSchema } from "../../../local/configuration.js";
import { InstallationError } from "../../errors.js";
import { optionalCa } from "./certificates.js";

import type { SetupInputs } from "../../save.js";
import { secretInput } from "../secrets.js";

export async function collectConnections(
  ui: InstallerPrompts,
  current: InstallationConfiguration["connections"],
  inputs: SetupInputs,
): Promise<InstallationConfiguration["connections"]> {
  const mode = await ui.select(
    "Connections",
    [
      { value: "back", label: "Back to installation" },
      { value: "disabled", label: "Do not enable Connections" },
      { value: "external", label: "Use an existing Connections broker" },
      { value: "local", label: "Run Connections with a Composio project" },
    ],
    current.mode,
  );
  if (mode === "back") return current;
  if (mode === "disabled") return { mode };
  if (mode === "external")
    return {
      mode,
      brokerUrl: await field(
        ui,
        "Connections broker URL",
        connectionsBrokerUrlSchema,
        current.mode === "external" ? current.brokerUrl : undefined,
      ),
      credentialFile: await secretInput(
        ui,
        inputs,
        "Scoped broker key",
        "broker-key",
        current.mode === "external" ? current.credentialFile : undefined,
      ),
      ...(await optionalCa(
        ui,
        current.mode === "external" ? current.caFile : undefined,
      )),
    };
  if (mode !== "local")
    throw new InstallationError(
      "invalid_configuration",
      "Select a supported Connections mode.",
    );
  return {
    mode,
    projectId: await ui.text(
      "Composio project ID",
      current.mode === "local" ? current.projectId : undefined,
    ),
    apiKeyFile: await secretInput(
      ui,
      inputs,
      "Composio project key",
      "connections-key",
      current.mode === "local" ? current.apiKeyFile : undefined,
    ),
    catalogDirectory: absolute(
      await ui.text(
        "Prepared connector catalog directory",
        current.mode === "local" ? current.catalogDirectory : undefined,
      ),
    ),
  };
}
