import { InstallationError } from "./errors.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readInputFile } from "./files.js";
import {
  installationSchema,
  type InstallationConfiguration,
} from "./configuration.js";

/** Unsaved generated inputs stay in memory until the user accepts the preview. */
export class SetupInputs {
  readonly files = new Map<string, Buffer>();
  constructor(readonly directory: string) {}
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
) {
  const config = installationSchema.parse(value);
  if (
    Buffer.byteLength(
      join(resolve(directory, config.stateDirectory), "operator.sock"),
    ) > 100
  )
    throw new InstallationError(
      "invalid_configuration",
      "Choose a shorter installation directory (the control socket path must fit within 100 bytes).",
    );
  const files = new Map<string, Buffer>();
  async function secret(source: string, name: string) {
    const path = join("secrets", name);
    files.set(
      path,
      inputs?.files.get(source) ?? (await readInputFile(source, true)),
    );
    return `./${path}`;
  }
  if (config.access.mode === "oidc")
    config.access.clientSecretFile = await secret(
      config.access.clientSecretFile,
      "oidc-client-secret",
    );
  if (config.exposure.mode === "https")
    config.exposure.keyFile = await secret(
      config.exposure.keyFile,
      "tls-key.pem",
    );
  if (config.models.mode === "external")
    config.models.credentialFile = await secret(
      config.models.credentialFile,
      "model-key",
    );
  if (config.models.mode === "litellm")
    config.models.upstreamEnvironmentFile = await secret(
      config.models.upstreamEnvironmentFile,
      "models.env",
    );
  if (config.connections.mode === "local")
    config.connections.apiKeyFile = await secret(
      config.connections.apiKeyFile,
      "connections-key",
    );
  if (config.connections.mode === "external")
    config.connections.credentialFile = await secret(
      config.connections.credentialFile,
      "broker-key",
    );
  for (const [index, pack] of config.packs.entries())
    if (pack.bindingsFile)
      pack.bindingsFile = await secret(
        pack.bindingsFile,
        `pack-${String(index)}-bindings.json`,
      );
  // Exclusive creation also protects against another installer winning the same path.
  await mkdir(directory, { mode: 0o700 });
  if (files.size) await mkdir(join(directory, "secrets"), { mode: 0o700 });
  for (const [path, bytes] of files)
    await writeFile(join(directory, path), bytes, { mode: 0o600, flag: "wx" });
  const path = join(directory, "installation.json");
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  return path;
}
