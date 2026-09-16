import { z } from "zod";
import { localInput } from "../../../local/configuration.js";
import { InstallationError } from "../../errors.js";
import type { InstallationDraft } from "../../configuration.js";
import type { InstallerPrompts } from "../prompts.js";
import { field, inputFile } from "../inputs.js";

import type { SetupInputs } from "../../save.js";
import { secretInput } from "../secrets.js";

export async function collectAccess(
  ui: InstallerPrompts,
  current: InstallationDraft,
  inputs: SetupInputs,
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
        hint: "Requires HTTPS, an existing OIDC client and the administrator's subject ID",
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
      team.shape.origin,
      https?.applicationOrigin,
    );
    const widgetOrigin = await field(
      ui,
      "Widgets HTTPS origin (separate listener port)",
      team.shape.widgetOrigin.refine(
        (value) => new URL(value).port !== new URL(applicationOrigin).port,
        "Use distinct listener ports for this single-host deployment.",
      ),
      https?.widgetOrigin,
    );
    ui.note(
      `Configure your OIDC client callback as ${applicationOrigin}/_clawscarf/callback and post-logout callback as ${applicationOrigin}/_clawscarf/signed-out. DNS and a valid TLS certificate for both origins must already exist. Only the administrator identity you supply is initially admitted.`,
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
      keyFile: await inputFile(
        ui,
        "TLS private key file",
        true,
        https?.keyFile,
      ),
    };
    access = {
      mode: "oidc",
      administratorName,
      issuer: await field(
        ui,
        "OIDC issuer",
        team.shape.issuer,
        previous?.issuer,
      ),
      clientId: await ui.text("OIDC client ID", previous?.clientId),
      clientSecretFile: await secretInput(
        ui,
        inputs,
        "OIDC client secret",
        "oidc-client-secret",
        previous?.clientSecretFile,
      ),
      administratorSubject: await ui.text(
        "Administrator OIDC subject ID",
        previous?.administratorSubject,
      ),
      administratorEmail: await field(
        ui,
        "Administrator email",
        z.email(),
        previous?.administratorEmail,
      ),
    };
  } else
    throw new InstallationError(
      "invalid_configuration",
      "Select local or OIDC access.",
    );
  return { access, exposure };
}
