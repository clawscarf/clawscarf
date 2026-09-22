import { openPack } from "../packs/source.js";
import { retainRuntime } from "./runtime.js";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { readInputFile } from "./files.js";
import {
  installationSchema,
  type InstallationConfiguration,
} from "./configuration.js";

/** Unsaved generated inputs stay in memory until the user accepts the preview. */
export class SetupInputs {
  readonly files = new Map<string, Buffer>();
  constructor(readonly directory: string) {}
  async readJson(path: string): Promise<unknown> {
    const bytes = this.files.get(path) ?? (await readInputFile(path));
    return JSON.parse(bytes.toString("utf8"));
  }
  set(name: string, value: string) {
    const path = resolve(this.directory, "secrets", name);
    this.files.set(path, Buffer.from(value));
    return path;
  }
}

/** Copy credentials into the new private installation directory, never into its JSON. */
export async function saveConfiguration(
  directory: string,
  value: InstallationConfiguration,
  inputs?: SetupInputs,
  retained = false,
) {
  const config = installationSchema.parse(value);
  const files = new Map<string, Buffer>();
  async function secret(source: string, name: string) {
    const path = join("secrets", name);
    files.set(
      path,
      inputs?.files.get(source) ?? (await readInputFile(source, true)),
    );
    return `./${path}`;
  }
  const modelConfiguration =
    inputs?.files.get(config.models.configurationFile) ??
    (await readInputFile(config.models.configurationFile));
  files.set("models.json", modelConfiguration);
  config.models.configurationFile = "./models.json";
  if (!retained && config.access.mode === "oidc")
    config.access.clientSecretFile = await secret(
      config.access.clientSecretFile,
      "oidc-client-secret",
    );
  if (!retained && config.exposure.mode === "https")
    config.exposure.keyFile = await secret(
      config.exposure.keyFile,
      "tls-key.pem",
    );
  if (config.models.mode === "external")
    config.models.credentialFile = await secret(
      config.models.credentialFile,
      "model-key",
    );
  if (config.models.mode === "litellm" && config.models.cloud) {
    if (retained && isAbsolute(config.models.upstreamEnvironmentFile)) {
      try {
        files.set(
          "secrets/cloud-ai.env.json",
          await readInputFile(
            config.models.upstreamEnvironmentFile + ".json",
            true,
          ),
        );
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
    }
    config.models.upstreamEnvironmentFile = "./secrets/cloud-ai.env";
  } else if (config.models.mode === "litellm")
    config.models.upstreamEnvironmentFile = await secret(
      config.models.upstreamEnvironmentFile,
      "models.env",
    );
  for (const [index, pack] of config.packs.entries())
    if (pack.bindingsFile)
      pack.bindingsFile = await secret(
        pack.bindingsFile,
        `pack-${String(index)}-bindings.json`,
      );
  // Exclusive creation also protects against another installer winning the same path.
  await mkdir(directory, { mode: 0o700 });
  try {
    if (!retained)
      config.releaseFile = await retainRuntime(
        resolve(config.releaseFile),
        directory,
      );
    if (config.packs.length)
      await mkdir(resolve(directory, config.stateDirectory), {
        recursive: true,
        mode: 0o700,
      });
    for (const pack of config.packs) {
      const source = await openPack(pack.directory);
      const destination = join(
        resolve(directory, config.stateDirectory),
        "pack-sources",
        source.digest,
      );
      if (resolve(pack.directory) !== destination) {
        await cp(source.root, destination, {
          recursive: true,
          errorOnExist: true,
          force: false,
        }).catch(async (error: unknown) => {
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          ))
            throw error;
          if ((await openPack(destination)).digest !== source.digest)
            throw error;
        });
        pack.directory = destination;
      }
    }
    if (files.size) await mkdir(join(directory, "secrets"), { mode: 0o700 });
    for (const [path, bytes] of files)
      await writeFile(join(directory, path), bytes, {
        mode: 0o600,
        flag: "wx",
      });
    const path = join(directory, "installation.json");
    await writeFile(path, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    return path;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
