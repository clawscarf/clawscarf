import { styleText } from "node:util";
import { registerCloudServices } from "../../cloud/registration.js";
import { authorizeCloud } from "../../cloud/login.js";
import {
  terminalLink,
  type InstallerPrompts,
  type progress,
} from "./prompts.js";

export function registerWithBrowser(
  configFile: string,
  ui: InstallerPrompts,
  task: typeof progress,
  register = registerCloudServices,
) {
  return task("Connecting selected cloud services", (signal) =>
    register(configFile, (url) =>
      authorizeCloud(
        url,
        (link, code) => {
          ui.note(
            `${terminalLink(link)}\n\nApproval code: ${code}`,
            styleText(
              ["bold", "yellow"],
              "ACTION REQUIRED — Sign in to ClawScarf",
            ),
          );
        },
        signal,
      ),
    ),
  );
}
