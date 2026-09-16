import { join } from "node:path";
import {
  serviceLogFile,
  type LocalLogFile,
  type MonitoredService,
} from "./logs.js";

/** Each required service gets its own wait process: any exit ends the installation lifetime. */
export async function monitorComposeServices(
  directory: string,
  services: readonly MonitoredService[],
  spawn: (
    executable: string,
    args: string[],
    log: LocalLogFile,
  ) => Promise<unknown>,
) {
  for (const service of services)
    await spawn(
      "docker",
      ["compose", "-f", join(directory, "compose.json"), "wait", service],
      serviceLogFile(service),
    );
}
