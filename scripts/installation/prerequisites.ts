import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { LocalSetupError, run } from "../deployment/process.js";
import { portAvailable, verifyLocalPorts } from "../deployment/preflight.js";
import { readState } from "../deployment/state.js";
import {
  openshellGatewayImage,
  verifyRuntimeImage,
} from "../deployment/images.js";
import {
  installationSchema,
  type InstallationConfiguration,
} from "./configuration.js";
import { setupContext, assertReleaseCapabilities } from "./setup.js";
import { readJson, verifyReleaseTool } from "./files.js";
import { InstallationError } from "./errors.js";

/** No configuration, credentials or cloud account is needed for these checks. */
export async function checkHost(command: typeof run = run) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new InstallationError(
      "unsupported_platform",
      "This release requires macOS on Apple Silicon with Docker Desktop.",
    );
  let os: string;
  try {
    os = await command("docker", ["info", "--format", "{{.OSType}}"]);
  } catch (error) {
    const missing =
      error instanceof LocalSetupError &&
      error.commandFailure?.reason === "spawn" &&
      error.commandFailure.systemCode === "ENOENT";
    throw new InstallationError(
      "unavailable",
      missing
        ? "Docker is not installed or is not on PATH. Install Docker Desktop, start it, then run configure again."
        : "Cannot reach Docker. Start Docker Desktop and wait until it is running, then try again.",
    );
  }
  if (os.trim() !== "linux")
    throw new InstallationError(
      "unsupported_platform",
      "Docker must run Linux containers.",
    );
  try {
    await command("docker", ["compose", "version"]);
  } catch {
    throw new InstallationError(
      "unavailable",
      "Docker Compose is unavailable. Install or update Docker Desktop, then try again.",
    );
  }
}

/** Stream only Docker's layer progress, never registry error payloads or credentials. */
export function pullImage(
  image: string,
  report: (message: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["pull", image], {
      stdio: ["ignore", "pipe", "pipe"],
      ...(signal ? { signal } : {}),
      timeout: 30 * 60_000,
    });
    let last = 0;
    let spawnFailed = false;
    const readers = [child.stdout, child.stderr].map((stream) =>
      createInterface({ input: stream }),
    );
    for (const reader of readers)
      reader.on("line", (line: string) => {
        if (
          /^[a-f0-9]{12}: (?:Pulling fs layer|Waiting|Downloading|Extracting|Verifying Checksum|Download complete|Pull complete)(?:\s+\[[=> ]*\]\s+[\d.]+[kMGT]?B\/[\d.]+[kMGT]?B)?$/.test(
            line,
          ) &&
          Date.now() - last >= 500
        ) {
          report(`${image.split("@")[0] ?? image} — ${line}`);
          last = Date.now();
        }
      });
    child.once("error", () => {
      spawnFailed = true;
    });
    child.once("close", (code) => {
      readers.forEach((reader) => {
        reader.close();
      });
      if (signal?.aborted)
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Download cancelled."),
        );
      else if (spawnFailed)
        reject(
          new InstallationError(
            "unavailable",
            "Image download could not start. Check Docker and try again.",
          ),
        );
      else if (code === 0) resolve();
      else
        reject(
          new InstallationError(
            "unavailable",
            `Could not download ${image}. Check network access and registry authentication, then run configure again.`,
          ),
        );
    });
  });
}

export async function checkNewInstallationPorts(
  exposure: InstallationConfiguration["exposure"],
) {
  const ports =
    exposure.mode === "local"
      ? [exposure.applicationPort, exposure.widgetPort]
      : [
          Number(new URL(exposure.applicationOrigin).port || 443),
          Number(new URL(exposure.widgetOrigin).port || 443),
        ];
  const host = exposure.mode === "local" ? "127.0.0.1" : "0.0.0.0";
  for (const port of ports)
    if (!(await portAvailable(port, host)))
      throw new InstallationError(
        "unavailable",
        `Port ${host}:${String(port)} is already in use. Stop its current owner or choose different listener ports in configure.`,
      );
}

/** Runs before cloud registration; release tools are bundled, registry images may be fetched. */
export async function checkInstallationPrerequisites(
  configFile: string,
  options: {
    acquire?: boolean;
    report?: (message: string) => void;
    signal?: AbortSignal;
  } = {},
  command: typeof run = run,
  pull: typeof pullImage = pullImage,
) {
  const report = options.report ?? (() => {});
  const config = installationSchema.parse(await readJson(configFile));
  const base = dirname(resolve(configFile));
  const { release, releaseFile } = await setupContext({
    release: resolve(base, config.releaseFile),
  });
  assertReleaseCapabilities(
    { release, releaseFile, recipes: release.recipes },
    config,
  );
  for (const tool of [
    release.tools.openshell.cli,
    release.tools.openshell.gateway,
  ]) {
    const path = resolve(dirname(releaseFile), tool.file);
    try {
      await verifyReleaseTool(path, tool.sha256);
    } catch (error) {
      if (error instanceof InstallationError) throw error;
      throw new InstallationError(
        "release_mismatch",
        `The bundled tool ${tool.file} is unavailable. Restore the complete release bundle; tools are not downloaded separately.`,
      );
    }
  }
  report("Bundled tools verified");
  let state;
  try {
    state = await readState(resolve(base, config.stateDirectory));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  if (state) await verifyLocalPorts(state, command);
  else {
    await checkNewInstallationPorts(config.exposure);
  }
  if (config.packOperator)
    await command(
      resolve(base, config.packOperator.pythonExecutable),
      ["-c", "from openshell.sandbox import SandboxClient"],
      { timeout: 10000 },
    );
  const images = [
    ...new Set([
      release.images.gateway,
      release.images.companion,
      release.images.openshellClient,
      release.images.postgres,
      openshellGatewayImage,
      ...(config.models.mode === "litellm" && release.images.models
        ? [release.images.models]
        : []),
      ...(config.browser.enabled && release.images.browser
        ? [
            ...Object.values(release.images.browser),
            ...(release.images.relay ? [release.images.relay] : []),
          ]
        : []),
    ]),
  ];
  const missing: string[] = [];
  for (const image of images) {
    options.signal?.throwIfAborted();
    try {
      await command("docker", ["image", "inspect", image]);
    } catch (error) {
      if (!(
        error instanceof LocalSetupError &&
        error.commandFailure?.reason === "exit" &&
        error.commandFailure.exitCode === 1
      ))
        throw error;
      missing.push(image);
    }
  }
  if (missing.length) {
    await checkHost(command);
    const local = missing.filter((image) => image.startsWith("sha256:"));
    if (local.length)
      throw new InstallationError(
        "unavailable",
        `Missing local development images: ${local.join(", ")}. Rebuild the development images and release bundle; these image IDs cannot be downloaded.`,
      );
    if (!options.acquire)
      throw new InstallationError(
        "unavailable",
        `Missing images: ${missing.join(", ")}. Run configure to download them.`,
      );
    report(
      `Downloading ${String(missing.length)} required images (first setup can take several minutes):\n${missing.map((image) => `  ${image}`).join("\n")}`,
    );
    for (const image of missing) {
      options.signal?.throwIfAborted();
      report(`Downloading ${image}`);
      await pull(image, report, options.signal);
      await command("docker", ["image", "inspect", image]);
    }
  } else
    report(
      `All ${String(images.length)} required images are already available`,
    );
  await verifyRuntimeImage(release.images.gateway, command);
  options.signal?.throwIfAborted();
  return {
    state: "prerequisites_available",
    platform: `${process.platform}-${process.arch}`,
    release: release.version,
    images: images.length,
  };
}
