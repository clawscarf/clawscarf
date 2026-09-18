import { checkHost, checkInstallationPrerequisites } from "./prerequisites.js";
import { allocatePorts, resolveInstallation } from "./resolve.js";
export async function doctorInstallation(configFile: string) {
  await checkHost();
  const result = await checkInstallationPrerequisites(configFile);
  await resolveInstallation(configFile, await allocatePorts());
  return result;
}
