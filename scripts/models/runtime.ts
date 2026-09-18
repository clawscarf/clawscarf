import {
  modelResultSchema,
  ModelConfigurationError,
  type ModelState,
} from "../../runtime/model-contract.js";
import { spawn } from "node:child_process";
import { nativeAssignments, type ModelConfiguration } from "./configuration.js";
/** Use the same packaged native helper while its owned home volume is stopped. */
export async function configureStoppedRuntimeModels(options: {
  image: string;
  volume: string;
  configuration: ModelConfiguration;
  credential: { token: string; ca?: string };
  apply: boolean;
}) {
  return runModelHelper(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "--pull",
      "never",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--user",
      "1000:1000",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=64m",
      "--mount",
      `type=volume,source=${options.volume},target=/home/node,volume-nocopy`,
      "--entrypoint",
      "node",
      options.image,
      "/app/clawscarf/models-main.js",
    ],
    {
      assignments: nativeAssignments(options.configuration),
      ...options.credential,
      ca: options.credential.ca ?? null,
      apply: options.apply,
    },
  );
}

/** Preserve structured helper failures and never replay an uncertain apply. */
function runModelHelper(
  executable: string,
  args: string[],
  input: {
    assignments: ReturnType<typeof nativeAssignments>;
    token: string;
    ca: string | null;
    apply: boolean;
  },
) {
  return new Promise<ModelState>((resolve, reject) => {
    let output = "";
    const child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "ignore"],
      signal: AbortSignal.timeout(60_000),
    });
    let spawned = false;
    const transportFailure = () =>
      new ModelConfigurationError(
        input.apply && spawned ? "outcome_unknown" : "unavailable",
      );
    child.once("spawn", () => {
      spawned = true;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 4096) {
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
    child.stdin.end(JSON.stringify(input));
  });
}
