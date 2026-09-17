import type { InstallationConfiguration } from "../../configuration.js";
import { localInput } from "../../../deployment/configuration.js";
import type { InstallerPrompts } from "../prompts.js";
import { field } from "../inputs.js";

export async function collectResources(
  ui: InstallerPrompts,
  current: InstallationConfiguration["resources"],
) {
  const resources = structuredClone(current);
  for (const component of ["gateway", "worker"] as const) {
    resources[component] = {
      cpu: await field(
        ui,
        `${component} CPUs`,
        localInput.shape.cpu,
        current[component].cpu,
      ),
      memory: await field(
        ui,
        `${component} memory`,
        localInput.shape.memory,
        current[component].memory,
      ),
    };
  }
  return resources;
}
