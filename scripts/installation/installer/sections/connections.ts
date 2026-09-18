import type { InstallationConfiguration } from "../../configuration.js";
import type { InstallerPrompts } from "../prompts.js";

export async function collectConnections(
  ui: InstallerPrompts,
  current: InstallationConfiguration["connections"],
): Promise<InstallationConfiguration["connections"]> {
  const enabled = await ui.confirm(
    "Enable Connections?",
    current.mode !== "disabled",
  );
  return { ...current, mode: enabled ? "hosted" : "disabled" };
}
