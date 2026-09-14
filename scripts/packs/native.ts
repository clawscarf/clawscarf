import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
const execute = promisify(execFile);
export class NativeClaws {
  constructor(
    private readonly executable: string,
    readonly supportsConnectionBindings = true,
  ) {}
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
  async defaultModel() {
    const status = await this.run(["models", "status", "--json", "--check"]);
    return z.object({ resolvedDefault: z.string().min(1) }).parse(status)
      .resolvedDefault;
  }
}
