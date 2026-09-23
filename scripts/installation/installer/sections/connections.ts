import type { InstallationConfiguration } from "../../configuration.js";
import type { InstallerPrompts } from "../prompts.js";

export async function collectConnections(
  ui: InstallerPrompts,
  current: InstallationConfiguration["connections"],
): Promise<InstallationConfiguration["connections"]> {
  ui.note(
    "Let agents work with your business apps. Link accounts and choose which agents may use them; connection credentials stay outside OpenClaw. Usage beyond your account's allowance requires prepaid packs. Link business accounts later in Connections.",
    "ClawScarf Cloud Connections",
  );
  const enabled = await ui.confirm(
    "Enable Connections?",
    current.mode !== "disabled",
  );
  return { ...current, mode: enabled ? "hosted" : "disabled" };
}
