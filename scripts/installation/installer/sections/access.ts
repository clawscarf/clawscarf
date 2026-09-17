import { z } from "zod";
import type { InstallationDraft } from "../../configuration.js";
import type { InstallerPrompts } from "../prompts.js";
import { field, inputFile } from "../inputs.js";

export async function collectAccess(
  ui: InstallerPrompts,
  current: InstallationDraft,
) {
  const custom = await ui.confirm(
    "Use your own OIDC provider?",
    current.access.mode === "oidc",
  );
  if (!custom)
    return {
      access: {
        mode: "hosted" as const,
        administratorName: current.access.administratorName,
        registrationFile: "./secrets/hosted-login.json",
        ...(current.access.mode === "hosted" && current.access.cloudUrl
          ? { cloudUrl: current.access.cloudUrl }
          : {}),
      },
    };
  const previous = current.access.mode === "oidc" ? current.access : undefined;
  const origin =
    current.exposure.mode === "https"
      ? current.exposure.applicationOrigin
      : `http://127.0.0.1:${String(current.exposure.applicationPort)}`;
  ui.note(
    `Callback: ${origin}/_clawscarf/callback\nAfter logout: ${origin}/_clawscarf/signed-out`,
    "OIDC application URLs",
  );
  const issuer = await field(ui, "OIDC issuer", z.url(), previous?.issuer);
  const clientId = await ui.text("OIDC client ID", previous?.clientId);
  return {
    access: {
      mode: "oidc" as const,
      administratorName: current.access.administratorName,
      issuer,
      clientId,
      clientSecretFile:
        previous?.issuer === issuer && previous.clientId === clientId
          ? previous.clientSecretFile
          : "",
      ...(previous?.issuer === issuer &&
      previous.clientId === clientId &&
      previous.administratorSubject &&
      previous.administratorEmail
        ? {
            administratorSubject: previous.administratorSubject,
            administratorEmail: previous.administratorEmail,
          }
        : {}),
    },
  };
}

export async function collectExposure(
  ui: InstallerPrompts,
  current: InstallationDraft,
) {
  const network = await ui.confirm(
    "Make this server available over HTTPS?",
    current.exposure.mode === "https",
  );
  if (!network) {
    const port = z
      .string()
      .regex(/^\d+$/)
      .refine(
        (value) => Number(value) >= 1024 && Number(value) <= 65535,
        "Use a port from 1024 to 65535.",
      );
    const previous =
      current.exposure.mode === "local" ? current.exposure : undefined;
    const applicationPort = Number(
      await field(
        ui,
        "Application port",
        port,
        String(previous?.applicationPort ?? 18800),
      ),
    );
    const widgetPort = Number(
      await field(
        ui,
        "Widgets port",
        port.refine(
          (value) => Number(value) !== applicationPort,
          "Use a different port.",
        ),
        String(previous?.widgetPort ?? 18802),
      ),
    );
    return { mode: "local" as const, applicationPort, widgetPort };
  }
  const previous =
    current.exposure.mode === "https" ? current.exposure : undefined;
  const origin = z
    .url()
    .refine(
      (value) =>
        new URL(value).origin === value && new URL(value).protocol === "https:",
      "Use an HTTPS origin.",
    );
  const applicationOrigin = await field(
    ui,
    "Application HTTPS origin",
    origin,
    previous?.applicationOrigin,
  );
  const widgetOrigin = await field(
    ui,
    "Widgets HTTPS origin",
    origin.refine(
      (value) => new URL(value).port !== new URL(applicationOrigin).port,
      "Use distinct listener ports.",
    ),
    previous?.widgetOrigin,
  );
  const certificateFile = await inputFile(
    ui,
    "TLS certificate file",
    false,
    previous?.certificateFile,
  );
  return {
    mode: "https" as const,
    applicationOrigin,
    widgetOrigin,
    certificateFile,
    keyFile:
      previous?.certificateFile === certificateFile ? previous.keyFile : "",
  };
}
