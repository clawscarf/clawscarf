import { readInputFile } from "../files.js";
import { InstallationError } from "../errors.js";
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

export async function registerUnattended(
  configFile: string,
  credentialFile: string | undefined,
  register = registerCloudServices,
) {
  await register(configFile, async () => {
    if (!credentialFile)
      throw new InstallationError(
        "invalid_configuration",
        "Hosted registration requires --cloud-credential-file in noninteractive mode. Omit --non-interactive to sign in through the browser.",
      );
    return (await readInputFile(credentialFile, true)).toString("utf8").trim();
  });
}
