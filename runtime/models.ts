import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  modelInputSchema,
  ModelConfigurationError,
  type ModelInput,
} from "./model-contract.js";
import { promisify } from "node:util";
const execute = promisify(execFile);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseInput(value: unknown): ModelInput {
  const result = modelInputSchema.safeParse(value);
  if (!result.success) throw new ModelConfigurationError("invalid_input");
  return result.data;
}
export async function configure(
  input: ModelInput,
  options: { stateDirectory: string; executable: string },
) {
  // Revalidate at the effect boundary, including callers that bypass the CLI.
  input = parseInput(input);
  let dispatched = false;
  let invoked = false;
  try {
    const directory = join(options.stateDirectory, "clawscarf-models");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || (stat.mode & 0o077) !== 0)
      throw new ModelConfigurationError("invalid_state");
    const id = randomUUID();
    const credential = join(directory, `${id}.json`);
    const batch = join(directory, `${id}.batch.json`);
    const secret = (name: string) => ({
      source: "file",
      provider: "clawscarf-models",
      id: `/${name}`,
    });
    const assignments = input.assignments.map((entry) => {
      if (entry.path === "secrets.providers.clawscarf-models")
        return {
          path: entry.path,
          value: { source: "file", path: credential, mode: "json" },
        };
      if (entry.path === "models.providers.clawscarf") {
        return {
          path: entry.path,
          value: {
            ...entry.value,
            apiKey: secret("token"),
          },
        };
      }
      return entry;
    });
    await writeFile(
      credential,
      JSON.stringify({
        token: input.token,
        ...(input.ca ? { ca: input.ca } : {}),
      }),
      { flag: "wx", mode: 0o600 },
    );
    try {
      await writeFile(batch, JSON.stringify(assignments), {
        flag: "wx",
        mode: 0o600,
      });
      dispatched = true;
      invoked = true;
      await execute(
        options.executable,
        [
          "config",
          "set",
          "--batch-file",
          batch,
          "--replace",
          ...(input.apply ? [] : ["--dry-run"]),
        ],
        {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            OPENCLAW_STATE_DIR: options.stateDirectory,
            OPENCLAW_CONFIG_PATH: join(options.stateDirectory, "openclaw.json"),
            SQLITE_TMPDIR: "/tmp",
          },
        },
      ).catch((error: unknown) => {
        if (
          record(error) &&
          ["ENOENT", "EACCES"].includes(String(error.code))
        ) {
          dispatched = false;
          throw new ModelConfigurationError("unavailable");
        }
        throw new ModelConfigurationError(
          input.apply
            ? "outcome_unknown"
            : record(error) && typeof error.code === "number"
              ? "validation_rejected"
              : "unavailable",
        );
      });
      let restartRequired = false;
      if (input.apply) {
        const trust = join(directory, "ca.pem");
        let previousTrust: string | null = null;
        try {
          previousTrust = await readFile(trust, "utf8");
        } catch (error) {
          if (!record(error) || error.code !== "ENOENT") throw error;
        }
        restartRequired = previousTrust !== input.ca;
        if (input.ca) {
          const stagedTrust = join(directory, `${id}.ca.pem`);
          await writeFile(stagedTrust, input.ca, { flag: "wx", mode: 0o600 });
          await rename(stagedTrust, trust);
        } else await rm(trust, { force: true });
      }
      return input.apply
        ? restartRequired
          ? "configured_restart_required"
          : "configured"
        : "validated";
    } finally {
      await rm(batch, { force: true });
      // An uncertain apply may already reference the staged credential; retain it.
      if (!input.apply || !dispatched) await rm(credential, { force: true });
    }
  } catch (error) {
    if (error instanceof ModelConfigurationError) throw error;
    throw new ModelConfigurationError(
      invoked && input.apply ? "outcome_unknown" : "invalid_state",
    );
  }
}
