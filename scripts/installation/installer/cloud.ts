import { readInputFile } from "../files.js";
import { styleText } from "node:util";
import { registerCloudServices } from "../../cloud/registration.js";
import { authorizeCloud } from "../../cloud/login.js";
import type { CloudAiSession } from "../../cloud/ai.js";
import type { AiFundingOptions } from "../../cloud/billing.js";
import { completeAiFunding } from "./billing.js";
import { unattendedPrompts } from "./prompts.js";
import {
  terminalLink,
  type InstallerPrompts,
  type progress,
} from "./prompts.js";

export async function registerWithBrowser(
  configFile: string,
  ui: InstallerPrompts,
  task: typeof progress,
  register = registerCloudServices,
  options: AiFundingOptions = {},
) {
  let session: CloudAiSession | undefined;
  await task("Connecting selected cloud services", (signal) =>
    register(
      configFile,
      (url, file, administrator) =>
        authorizeCloud(url, file, {
          wait: true,
          present: async (link, code, expiresAt) => {
            ui.note(
              `${administrator ? "Create an account or sign in to set up this installation and become its first administrator." : "Create an account or sign in to authorize the selected cloud services."}\n\n${terminalLink(link)}\n\nApproval code: ${code} — check that it matches the website.\n\nExpires at ${expiresAt}. Return to this terminal after approval.`,
              styleText(
                ["bold", "yellow"],
                "ACTION REQUIRED — Create an account or sign in",
              ),
            );
            await ui.openBrowser(link);
          },
          signal,
        }),
      (value) => {
        session = value;
      },
    ),
  );
  return session ? completeAiFunding(session, ui, task, options) : undefined;
}

export async function registerUnattended(
  configFile: string,
  credentialFile: string | undefined,
  register = registerCloudServices,
  options: AiFundingOptions = {},
) {
  let session: CloudAiSession | undefined;
  await register(
    configFile,
    async (url, file) => {
      if (!credentialFile) return authorizeCloud(url, file, { wait: false });
      return (await readInputFile(credentialFile, true))
        .toString("utf8")
        .trim();
    },
    (value) => {
      session = value;
    },
  );
  return session
    ? completeAiFunding(
        session,
        unattendedPrompts,
        async (_message, work) => work(new AbortController().signal, () => {}),
        { ...options, nonInteractive: true },
      )
    : undefined;
}
