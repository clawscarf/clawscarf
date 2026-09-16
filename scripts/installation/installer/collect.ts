import { join } from "node:path";
import { z } from "zod";
import {
  installationSchema,
  type InstallationConfiguration,
} from "../configuration.js";
import { readJson } from "../files.js";
import { InstallationError } from "../errors.js";
import { releaseSchema } from "../../release/definition.js";
import { localInput } from "../../local/configuration.js";
import type { InstallerPrompts } from "./prompts.js";
import { absolute, field, inputFile, newDirectory } from "./inputs.js";
import {
  collectConnections,
  collectModels,
  collectPacks,
} from "./capabilities.js";

export type InstallOptions = { directory?: string; release?: string };
export async function collectInstallation(
  ui: InstallerPrompts,
  options: InstallOptions,
) {
  const releaseFile = options.release
    ? absolute(options.release)
    : await inputFile(ui, "ClawScarf release file");
  const release = releaseSchema.parse(await readJson(releaseFile));
  if (
    !release.platforms.some(
      (platform) => platform === `${process.platform}-${process.arch}`,
    )
  )
    throw new InstallationError(
      "unsupported_platform",
      "This release does not support this host platform. No fallback protection mode is available.",
    );
  const directory = absolute(
    options.directory ??
      (await ui.text("New installation directory", "./clawscarf-team")),
  );
  await newDirectory(directory);
  if (Buffer.byteLength(join(directory, "state/operator.sock")) > 100)
    throw new InstallationError(
      "invalid_configuration",
      "Choose a shorter installation directory (the control socket path must fit within 100 bytes).",
    );
  const name = await field(
    ui,
    "Installation name",
    localInput.shape.name,
    "team",
  );
  const administratorName = await field(
    ui,
    "Administrator display name",
    localInput.shape.administratorName,
    "Administrator",
  );
  const mode = await ui.select("Access", [
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
  ]);
  let exposure: InstallationConfiguration["exposure"];
  let access: InstallationConfiguration["access"];
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
      await field(ui, "Application port", port, "18800"),
    );
    const widgetPort = Number(
      await field(
        ui,
        "Widgets port",
        port.refine(
          (value) => Number(value) !== applicationPort,
          "Use a different port from the application.",
        ),
        "18802",
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
    );
    const widgetOrigin = await field(
      ui,
      "Widgets HTTPS origin (separate listener port)",
      team.shape.widgetOrigin.refine(
        (value) => new URL(value).port !== new URL(applicationOrigin).port,
        "Use distinct listener ports for this single-host deployment.",
      ),
    );
    ui.note(
      `Configure your OIDC client callback as ${applicationOrigin}/_clawscarf/callback and post-logout callback as ${applicationOrigin}/_clawscarf/signed-out. DNS and a valid TLS certificate for both origins must already exist. Only the administrator identity you supply is initially admitted.`,
      "OIDC prerequisites",
    );
    exposure = {
      mode: "https",
      applicationOrigin,
      widgetOrigin,
      certificateFile: await inputFile(ui, "TLS certificate file"),
      keyFile: await inputFile(ui, "TLS private key file", true),
    };
    access = {
      mode: "oidc",
      administratorName,
      issuer: await field(ui, "OIDC issuer", team.shape.issuer),
      clientId: await ui.text("OIDC client ID"),
      clientSecretFile: await inputFile(ui, "OIDC client secret file", true),
      administratorSubject: await ui.text("Administrator OIDC subject ID"),
      administratorEmail: await field(ui, "Administrator email", z.email()),
    };
  } else
    throw new InstallationError(
      "invalid_configuration",
      "Select local or OIDC access.",
    );
  const resources = {
    gateway: { cpu: "2", memory: "2Gi" },
    worker: { cpu: "2", memory: "2Gi" },
  };
  if (
    await ui.confirm(
      "Customize resources? (default: 2 CPUs / 2 GiB each for Gateway and worker)",
    )
  )
    for (const component of ["gateway", "worker"] as const)
      resources[component] = {
        cpu: await field(ui, `${component} CPUs`, localInput.shape.cpu, "2"),
        memory: await field(
          ui,
          `${component} memory`,
          localInput.shape.memory,
          "2Gi",
        ),
      };
  let browser = false;
  if (release.images.browser) {
    ui.note(
      "Browser integration has an upstream routing bug: explicit node use works, but ordinary model-selected browsing is not qualified.",
      "Experimental browser",
    );
    browser = await ui.confirm("Enable the experimental browser?");
  }
  const models = await collectModels(ui, release);
  const connections = await collectConnections(ui);
  const packs = await collectPacks(ui, models, connections);
  return {
    directory,
    config: installationSchema.parse({
      schemaVersion: 1,
      name,
      releaseFile,
      stateDirectory: "./state",
      storage: { mode: "docker-volumes" },
      exposure,
      access,
      resources,
      browser: { enabled: browser },
      models,
      connections,
      ...packs,
    }),
  };
}
