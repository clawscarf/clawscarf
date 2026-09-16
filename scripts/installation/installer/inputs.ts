import { lstat, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { z } from "zod";
import type { InstallerPrompts } from "./prompts.js";
import { readInputFile } from "../files.js";
import { InstallationError } from "../errors.js";
import {
  installationSchema,
  type InstallationConfiguration,
} from "../configuration.js";

export function absolute(value: string) {
  return resolve(
    value.startsWith("~/") ? join(homedir(), value.slice(2)) : value,
  );
}
export async function newDirectory(path: string) {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
  throw new InstallationError(
    "change_unsupported",
    "Choose a new installation directory. This installer does not overwrite or reconfigure existing installations; use the existing CLI to resume them.",
  );
}
export async function field(
  ui: InstallerPrompts,
  message: string,
  schema: z.ZodType<string>,
  initial?: string,
) {
  const value = await ui.text(message, initial, (input) => {
    try {
      const result = schema.safeParse(input);
      return result.success ? undefined : result.error.issues[0]?.message;
    } catch {
      // Some existing refinements parse URLs; invalid input must stay in the prompt.
      return "Enter a valid value.";
    }
  });
  return schema.parse(value);
}
export async function inputFile(
  ui: InstallerPrompts,
  message: string,
  secret = false,
) {
  const value = await ui.text(message, undefined, async (input) => {
    if (!input.trim()) return "Enter a file path.";
    try {
      await readInputFile(absolute(input), secret);
    } catch {
      return secret
        ? "Use a private regular file owned by you (chmod 600)."
        : "Use an existing regular file (up to 8 MiB).";
    }
  });
  const path = absolute(value);
  await readInputFile(path, secret);
  return path;
}

/** Copy credentials into the new private installation directory, never into its JSON. */
export async function saveConfiguration(
  directory: string,
  value: InstallationConfiguration,
) {
  const config = installationSchema.parse(value);
  const files = new Map<string, Buffer>();
  async function secret(source: string, name: string) {
    const path = join("secrets", name);
    files.set(path, await readInputFile(source, true));
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
