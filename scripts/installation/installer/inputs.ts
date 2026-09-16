import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { z } from "zod";
import type { InstallerPrompts } from "./prompts.js";
import { readInputFile } from "../files.js";
import { InstallationError } from "../errors.js";

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
  initial?: string,
) {
  const value = await ui.text(message, initial, async (input) => {
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
