import { z } from "zod";
import { localInput } from "../../../local/configuration.js";
import { InstallationError } from "../../errors.js";
import type { InstallationDraft } from "../../configuration.js";
import type { InstallerPrompts } from "../prompts.js";
import { field, inputFile } from "../inputs.js";

export async function collectAccess(
  ui: InstallerPrompts,
  current: InstallationDraft,
) {
  const administratorName = current.access.administratorName;
  const previous = current.access.mode === "oidc" ? current.access : undefined;
  const https =
    current.exposure.mode === "https" ? current.exposure : undefined;
  const mode = await ui.select(
    "Access",
    [
      {
        value: "local",
        label: "Local evaluation",
        hint: "Loopback only; one-use administrator login code",
      },
      {
        value: "oidc",
        label: "Team server with OIDC",
        hint: "Sign in through your provider to become administrator",
      },
    ],
    current.access.mode,
  );
  let exposure: InstallationDraft["exposure"];
  let access: InstallationDraft["access"];
  if (mode === "local") {
    const port = z
      .string()
      .regex(/^\d+$/)
      .refine(
        (value) =>
          z.number().int().min(1024).max(65535).safeParse(Number(value))
            .success,
        "Use a port from 1024 to 65535.",
      );
    const applicationPort = Number(
      await field(
        ui,
        "Application port",
        port,
        current.exposure.mode === "local"
          ? String(current.exposure.applicationPort)
          : "18800",
      ),
    );
    const widgetPort = Number(
      await field(
        ui,
        "Widgets port",
        port.refine(
          (value) => Number(value) !== applicationPort,
          "Use a different port from the application.",
        ),
        current.exposure.mode === "local"
          ? String(current.exposure.widgetPort)
          : "18802",
      ),
    );
    exposure = { mode: "local", applicationPort, widgetPort };
    access = { mode: "local", administratorName };
  } else if (mode === "oidc") {
    const team = localInput.shape.team.unwrap();
    const applicationOrigin = await field(
      ui,
      "Application HTTPS origin",
      z.url().pipe(team.shape.origin),
      https?.applicationOrigin,
    );
    const widgetOrigin = await field(
      ui,
      "Widgets HTTPS origin (separate listener port)",
      z
        .url()
        .pipe(team.shape.widgetOrigin)
        .refine(
          (value) => new URL(value).port !== new URL(applicationOrigin).port,
          "Use distinct listener ports for this single-host deployment.",
        ),
      https?.widgetOrigin,
    );
    ui.note(
      `Configure your OIDC client callback as ${applicationOrigin}/_clawscarf/callback and post-logout callback as ${applicationOrigin}/_clawscarf/signed-out. DNS and a valid TLS certificate for both origins must already exist. A private setup link will establish the administrator after startup.`,
      "OIDC prerequisites",
    );
    exposure = {
      mode: "https",
      applicationOrigin,
      widgetOrigin,
      certificateFile: await inputFile(
        ui,
        "TLS certificate file",
        false,
        https?.certificateFile,
      ),
      keyFile:
        https?.applicationOrigin === applicationOrigin &&
        https.widgetOrigin === widgetOrigin
          ? https.keyFile
          : "",
    };
    const accessIssuer = await field(
      ui,
      "OIDC issuer",
      z.url().pipe(team.shape.issuer),
      previous?.issuer,
    );
    const accessClientId = await ui.text("OIDC client ID", previous?.clientId);
    access = {
      mode: "oidc",
      administratorName,
      issuer: accessIssuer,
      clientId: accessClientId,
      ...(previous?.issuer === accessIssuer &&
      previous.clientId === accessClientId &&
      previous.administratorSubject &&
      previous.administratorEmail
        ? {
            administratorSubject: previous.administratorSubject,
            administratorEmail: previous.administratorEmail,
          }
        : {}),
      clientSecretFile:
        previous?.issuer === accessIssuer &&
        previous.clientId === accessClientId
          ? previous.clientSecretFile
          : "",
    };
  } else
    throw new InstallationError(
      "invalid_configuration",
      "Select local or OIDC access.",
    );
  return { access, exposure };
}
