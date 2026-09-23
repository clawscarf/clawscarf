import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export const defaultInstallationDirectory = join(homedir(), "clawscarf-team");

/** A readable label only; installation and Cloud identities have their own IDs. */
export function installationName(directory: string) {
  const label = basename(resolve(directory))
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (/^[a-z]/.test(label) ? label : `team-${label}`)
    .slice(0, 30)
    .replace(/-+$/g, "");
}
