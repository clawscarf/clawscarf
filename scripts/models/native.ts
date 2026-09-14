import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  configurationSchema,
  nativeAssignments,
  type ModelConfiguration,
} from "./configuration.js";
const execute = promisify(execFile);
export async function loadConfiguration(path: string) {
  const input: unknown = JSON.parse(await readFile(path, "utf8"));
  return configurationSchema.parse(input);
}
export async function configureNativeModels(
  executable: string,
  configuration: ModelConfiguration,
  apply: boolean,
) {
  const assignments = nativeAssignments(configuration);
  if (assignments.length === 0) return { state: "disabled" };
  const { stdout } = await execute(executable, ["--version"], {
    timeout: 10000,
  });
  if (!/\b2026\.9\.4\b/.test(stdout))
    throw Error("Model configuration requires pinned OpenClaw 2026.9.4.");
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-models-"));
  const path = join(directory, "models.json");
  try {
    await writeFile(path, JSON.stringify(assignments), { mode: 0o600 });
    await execute(
      executable,
      [
        "config",
        "set",
        "--batch-file",
        path,
        "--replace",
        ...(apply ? [] : ["--dry-run"]),
      ],
      {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    );
    return { state: apply ? "configured" : "validated" };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
