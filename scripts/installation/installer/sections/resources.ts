import type { InstallationConfiguration } from "../../configuration.js";
import { localInput } from "../../../deployment/configuration.js";
import type { InstallerPrompts } from "../prompts.js";
import { field } from "../inputs.js";

export async function collectResources(
  ui: InstallerPrompts,
  current: InstallationConfiguration["resources"],
) {
  return {
    runtime: {
      cpu: await field(
        ui,
        "Runtime CPUs",
        localInput.shape.cpu,
        current.runtime.cpu,
      ),
      memory: await field(
        ui,
        "Runtime memory",
        localInput.shape.memory,
        current.runtime.memory,
      ),
    },
  };
}
