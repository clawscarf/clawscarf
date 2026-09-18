import { homedir } from "node:os";
import { join } from "node:path";

export const defaultInstallationDirectory = join(homedir(), "clawscarf-team");
