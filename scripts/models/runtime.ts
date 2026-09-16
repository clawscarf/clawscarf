import {
  modelResultSchema,
  ModelConfigurationError,
  type ModelState,
} from "../../runtime/model-contract.js";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { nativeAssignments, type ModelConfiguration } from "./configuration.js";
export async function configureRuntimeModels(options: {
  configuration: ModelConfiguration;
  openshell: string;
  sandbox: string;
  gateway: string;
  keyFile: string;
  caFile?: string;
  apply: boolean;
}) {
  const assignments = nativeAssignments(options.configuration);
  if (!assignments.length) return "disabled";
  const token = (await readFile(options.keyFile, "utf8")).trim();
  if (!token || token.length > 65536)
    throw new ModelConfigurationError("invalid_input");
  const ca = options.caFile ? await readFile(options.caFile, "utf8") : null;
  const input = JSON.stringify({
    assignments,
    token,
    ca,
    apply: options.apply,
  });
  return await new Promise<ModelState>((resolve, reject) => {
    let output = "";
    const child = spawn(
      options.openshell,
      [
        "sandbox",
        "exec",
        "--name",
        options.sandbox,
        "--gateway",
        options.gateway,
        "--no-tty",
        "--timeout",
        "45",
        "--",
        "node",
        "/app/clawscarf/models-main.js",
      ],
      { stdio: ["pipe", "pipe", "ignore"], timeout: 60000 },
    );
    let spawned = false;
    const transportFailure = () =>
      new ModelConfigurationError(
        options.apply && spawned ? "outcome_unknown" : "unavailable",
      );
    child.once("spawn", () => {
      spawned = true;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 1024) {
        child.kill();
        reject(transportFailure());
      }
    });
    child.once("error", () => {
      reject(transportFailure());
    });
    child.stdin.on("error", () => {
      reject(transportFailure());
    });
    child.once("close", (code) => {
      try {
        const value: unknown = JSON.parse(output);
        const result = modelResultSchema.safeParse(value);
        if (!result.success) {
          reject(transportFailure());
          return;
        }
        if (!result.data.ok) {
          reject(new ModelConfigurationError(result.data.error));
          return;
        }
        if (code !== 0) {
          reject(transportFailure());
          return;
        }
        resolve(result.data.state);
      } catch {
        reject(transportFailure());
      }
    });
    child.stdin.end(input);
  });
}
