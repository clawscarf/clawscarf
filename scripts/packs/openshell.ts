import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { verifyNetworkPolicy, type NetworkRequirement } from "./policy.js";
import { NativeClaws } from "./native.js";
import type { PackTarget } from "./model.js";
const execute = promisify(execFile);
const snapshotSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phase: z.literal("Ready"),
});
export class OpenShellClaws extends NativeClaws {
  constructor(
    private readonly options: {
      executable: string;
      python: string;
      sandbox: string;
      gateway: string;
      env?: NodeJS.ProcessEnv;
    },
  ) {
    super("/app/clawscarf/bin/openclaw");
  }
  private async shell(args: readonly string[]) {
    const child = execute(
      this.options.executable,
      [...args, "--gateway", this.options.gateway],
      {
        maxBuffer: 4 * 1024 * 1024,
        timeout: 120000,
        env: this.options.env ?? process.env,
      },
    );
    child.child.stdin?.end();
    const { stdout } = await child;
    return stdout;
  }
  private boundTarget: Extract<PackTarget, { kind: "openshell" }> | undefined;
  private async exec(command: readonly string[], stdin?: Buffer) {
    if (!this.boundTarget) await this.target();
    if (!this.boundTarget) throw Error("An observed target is required.");
    const child = execute(
      this.options.python,
      [fileURLToPath(new URL("./transport.py", import.meta.url))],
      {
        maxBuffer: 4 * 1024 * 1024,
        timeout: 120000,
        env: this.options.env ?? process.env,
      },
    );
    child.child.stdin?.end(
      JSON.stringify({
        gateway: this.options.gateway,
        sandboxId: this.boundTarget.sandboxId,
        command,
        stdin: stdin?.toString("base64") ?? "",
      }),
    );
    return (await child).stdout;
  }
  override async target(): Promise<PackTarget> {
    const gateway = snapshotSchema.parse(
      JSON.parse(
        await this.shell([
          "sandbox",
          "get",
          this.options.sandbox,
          "--output",
          "json",
        ]),
      ),
    );
    if (gateway.name !== this.options.sandbox)
      throw Error("Unexpected sandbox identity.");
    const target = {
      kind: "openshell" as const,
      gateway: this.options.gateway,
      sandbox: gateway.name,
      sandboxId: gateway.id,
    };
    if (this.boundTarget && this.boundTarget.sandboxId !== target.sandboxId)
      throw Error("Sandbox identity changed; create a new pack preview.");
    this.boundTarget = target;
    return target;
  }
  override async version() {
    if ((this.options.env ?? process.env).OPENCLAW_EXPERIMENTAL_CLAWS !== "1")
      throw Error(
        "Set OPENCLAW_EXPERIMENTAL_CLAWS=1 to acknowledge the experimental native Claws contract.",
      );
    const stdout = await this.exec([
      "/app/clawscarf/bin/openclaw",
      "--version",
    ]);
    if (!/\b2026\.9\.4\b/.test(stdout))
      throw Error("Packs require the pinned OpenClaw 2026.9.4 release.");
  }
  override async run(args: readonly string[]): Promise<unknown> {
    return JSON.parse(
      await this.exec(["/app/clawscarf/bin/openclaw", ...args]),
    );
  }
  override async source(root: string, digest: string, existing?: string) {
    const targetRoot =
      existing ??
      (
        await this.exec([
          "/usr/local/bin/node",
          "-e",
          "process.stdout.write(require('node:fs').mkdtempSync('/home/node/.clawscarf-pack-'))",
        ])
      ).trim();
    if (!/^\/home\/node\/\.clawscarf-pack-[A-Za-z0-9]+$/.test(targetRoot))
      throw Error("Invalid pack staging directory.");
    if (!existing) {
      const directory = await mkdtemp(join(tmpdir(), "clawscarf-pack-upload-"));
      try {
        const archive = join(directory, "source.tar");
        await execute("tar", ["-cf", archive, "-C", root, "."], {
          env: { ...process.env, COPYFILE_DISABLE: "1" },
        });
        await this.exec(
          ["tar", "-xf", "-", "-C", targetRoot],
          await readFile(archive),
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    const observed = z
      .object({ digest: z.string() })
      .parse(
        JSON.parse(
          await this.exec([
            "/app/clawscarf/bin/packs",
            "inspect",
            targetRoot,
            "--json",
          ]),
        ),
      );
    if (observed.digest !== digest)
      throw Error(
        "Target pack differs from reviewed source; create a new preview.",
      );
    return targetRoot;
  }
  override async network(requirements: readonly NetworkRequirement[]) {
    if (!requirements.length) return null;
    const target = await this.target();
    if (target.kind !== "openshell")
      throw Error("An OpenShell target is required.");
    for (const requirement of requirements) {
      await this.exec([
        "/usr/local/bin/node",
        "-e",
        "const fs=require('node:fs');fs.accessSync(process.argv[1],fs.constants.X_OK);if(fs.realpathSync(process.argv[1])!==process.argv[1])process.exit(1)",
        requirement.binary,
      ]);
    }
    return verifyNetworkPolicy(requirements, {
      sandbox: target.sandbox,
      sandboxId: target.sandboxId,
      run: (args) => this.shell(args),
    });
  }
  override async binary(name: string) {
    await this.exec([
      "/usr/local/bin/node",
      "-e",
      "const fs=require('node:fs'),path=require('node:path');if(!process.env.PATH.split(path.delimiter).some(p=>{try{fs.accessSync(path.join(p,process.argv[1]),fs.constants.X_OK);return true}catch{return false}}))process.exit(1)",
      name,
    ]);
  }
}
