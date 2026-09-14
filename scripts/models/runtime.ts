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
    throw Error("A scoped runtime key is required.");
  const ca = options.caFile ? await readFile(options.caFile, "utf8") : null;
  const input = JSON.stringify({
    assignments,
    token,
    ca,
    apply: options.apply,
  });
  return await new Promise<
    "configured" | "configured_restart_required" | "validated"
  >((resolve, reject) => {
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
        "/app/clawscarf/models.ts",
      ],
      { stdio: ["pipe", "pipe", "ignore"], timeout: 60000 },
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 1024) {
        child.kill();
        reject(Error("Unexpected runtime output."));
      }
    });
    child.once("error", reject);
    child.stdin.on("error", reject);
    child.once("close", (code) => {
      const state = output.trim();
      if (
        code === 0 &&
        (state === "configured" ||
          state === "configured_restart_required" ||
          state === "validated")
      )
        resolve(state);
      else
        reject(Error("Runtime configuration failed; inspect before retrying."));
    });
    child.stdin.end(input);
  });
}
