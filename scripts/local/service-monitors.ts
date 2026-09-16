import { join } from "node:path";

/** Each required service gets its own wait process: any exit ends the installation lifetime. */
export async function monitorComposeServices(
  directory: string,
  services: readonly string[],
  spawn: (executable: string, args: string[], log: string) => Promise<unknown>,
) {
  for (const service of services)
    await spawn(
      "docker",
      ["compose", "-f", join(directory, "compose.json"), "wait", service],
      `${service}-wait.log`,
    );
}
