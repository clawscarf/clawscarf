import { readInputFile } from "../files.js";
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
    register(
      configFile,
      (url, file, administrator) =>
        authorizeCloud(url, file, {
          wait: true,
          present: async (link, code, expiresAt) => {
            ui.note(
              `${administrator ? "Sign in or create an account to set up this installation and become its first administrator." : "Sign in or create an account to authorize the selected cloud services."}\n\n${terminalLink(link)}\n\nApproval code: ${code} — check that it matches the website.\n\nExpires at ${expiresAt}. Return to this terminal after approval.`,
              styleText(
                ["bold", "yellow"],
                "ACTION REQUIRED — Sign in to ClawScarf",
              ),
            );
            await ui.openBrowser(link);
          },
          signal,
        }),
      (message) => {
        ui.note(message, "Cloud AI");
      },
    ),
  );
}

export async function registerUnattended(
  configFile: string,
  credentialFile: string | undefined,
  register = registerCloudServices,
) {
  await register(configFile, async (url, file) => {
    if (!credentialFile) return authorizeCloud(url, file, { wait: false });
    return (await readInputFile(credentialFile, true)).toString("utf8").trim();
  });
}
