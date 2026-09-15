import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { NetworkRequirement, PolicyProof } from "./policy.js";
import type { PackTarget } from "./model.js";
const execute = promisify(execFile);
export class NativeClaws {
  constructor(
    private readonly executable: string,
    readonly supportsConnectionBindings = true,
  ) {}
  target(): Promise<PackTarget> {
    return Promise.resolve({ kind: "local" });
  }
  source(root: string, _digest: string, _existing?: string): Promise<string> {
    return Promise.resolve(root);
  }
  async binary(name: string) {
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
      try {
        await access(join(directory, name), constants.X_OK);
        return;
      } catch {
        continue;
      }
    }
    throw Error(`Required binary is unavailable: ${name}`);
  }
  async run(args: readonly string[]): Promise<unknown> {
    if (process.env.OPENCLAW_EXPERIMENTAL_CLAWS !== "1")
      throw Error(
        "Set OPENCLAW_EXPERIMENTAL_CLAWS=1 to acknowledge the experimental native Claws contract.",
      );
    const { stdout } = await execute(this.executable, [...args], {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120000,
    });
    const value: unknown = JSON.parse(stdout);
    return value;
  }
  async version() {
    const { stdout } = await execute(this.executable, ["--version"], {
      maxBuffer: 8192,
      timeout: 10000,
    });
    if (!/\b2026\.9\.4\b/.test(stdout))
      throw Error("Packs require the pinned OpenClaw 2026.9.4 release.");
  }
  network(
    requirements: readonly NetworkRequirement[],
  ): Promise<PolicyProof | null> {
    if (requirements.length)
      throw Error(
        "Network-dependent packs require a verified OpenShell target policy.",
      );
    return Promise.resolve(null);
  }
  async brokerUrl() {
    const enabled = await this.run([
      "config",
      "get",
      "plugins.entries.clawscarf-connections.enabled",
      "--json",
    ]);
    if (enabled !== true)
      throw Error("The target Connections plugin is not enabled.");
    return z
      .url()
      .parse(
        await this.run([
          "config",
          "get",
          "plugins.entries.clawscarf-connections.config.brokerUrl",
          "--json",
        ]),
      )
      .replace(/\/$/, "");
  }
  async defaultModel() {
    const status = await this.run(["models", "status", "--json", "--check"]);
    return z.object({ resolvedDefault: z.string().min(1) }).parse(status)
      .resolvedDefault;
  }
}
