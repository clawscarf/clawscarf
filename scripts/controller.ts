import { Command } from "commander";
import { execFile, spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execute = promisify(execFile);
const settingsSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
  port: z.number().int().min(1024).max(65535),
  gateway: z.string().min(1),
  cli: z.string().min(1),
});
type Settings = z.infer<typeof settingsSchema>;
const releaseInput: unknown = JSON.parse(
  await readFile(
    new URL("../release/components.json", import.meta.url),
    "utf8",
  ),
);
const release = z
  .object({
    openshell: z.object({
      version: z.string().min(1),
      supervisorImage: z.string().regex(/@sha256:[a-f0-9]{64}$/),
    }),
  })
  .parse(releaseInput).openshell;
function environment(directory: string) {
  if (Object.keys(process.env).some((name) => name.startsWith("OPENSHELL_")))
    throw Error(
      "Unset OPENSHELL_* environment overrides; this controller uses its private configuration.",
    );
  return {
    ...process.env,
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_STATE_HOME: join(directory, "state"),
    XDG_DATA_HOME: join(directory, "data"),
  };
}
async function protect(directory: string) {
  await chmod(directory, 0o700);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await protect(path);
    else if (entry.isFile()) await chmod(path, 0o600);
    else
      throw Error(
        "Controller state must not contain symlinks or special files.",
      );
  }
}
async function verifyExecutable(path: string) {
  const { stdout } = await execute(path, ["--version"], { timeout: 10000 });
  if (!stdout.trim().split(/\s+/).includes(release.version))
    throw Error(`Use the pinned OpenShell ${release.version} executable.`);
}
async function load(directory: string) {
  const value: unknown = JSON.parse(
    await readFile(join(directory, "controller.json"), "utf8"),
  );
  return settingsSchema.parse(value);
}
function toml(directory: string, settings: Settings) {
  const path = (value: string) => JSON.stringify(join(directory, "tls", value));
  return `[openshell]
version = 1
[openshell.gateway]
name = ${JSON.stringify(settings.name)}
bind_address = "127.0.0.1:${String(settings.port)}"
compute_drivers = ["docker"]
disable_tls = false
[openshell.gateway.tls]
cert_path = ${path("server/tls.crt")}
key_path = ${path("server/tls.key")}
client_ca_path = ${path("ca.crt")}
require_client_auth = true
[openshell.gateway.mtls_auth]
enabled = true
[openshell.gateway.auth]
allow_unauthenticated_users = false
[openshell.gateway.gateway_jwt]
signing_key_path = ${path("jwt/signing.pem")}
public_key_path = ${path("jwt/public.pem")}
kid_path = ${path("jwt/kid")}
gateway_id = ${JSON.stringify(settings.name)}
ttl_secs = 0
[openshell.drivers.docker]
network_name = ${JSON.stringify(settings.name)}
sandbox_namespace = ${JSON.stringify(settings.name)}
supervisor_image = ${JSON.stringify(release.supervisorImage)}
image_pull_policy = "IfNotPresent"
enable_bind_mounts = false
grpc_endpoint = "https://host.openshell.internal:${String(settings.port)}"
guest_tls_ca = ${path("ca.crt")}
guest_tls_cert = ${path("client/tls.crt")}
guest_tls_key = ${path("client/tls.key")}
`;
}
const command = new Command().name("clawscarf-controller");
command
  .command("init")
  .requiredOption("--directory <path>", "New private controller directory")
  .requiredOption("--gateway <path>", "Verified openshell-gateway executable")
  .requiredOption("--cli <path>", "Verified openshell executable")
  .option("--name <name>", "Isolated controller name", "clawscarf")
  .option("--port <port>", "Loopback controller port", "17671")
  .action(
    async (options: {
      directory: string;
      gateway: string;
      cli: string;
      name: string;
      port: string;
    }) => {
      const directory = resolve(options.directory);
      const env = environment(directory);
      const settings = settingsSchema.parse({
        name: options.name,
        port: Number(options.port),
        gateway: resolve(options.gateway),
        cli: resolve(options.cli),
      });
      await verifyExecutable(settings.gateway);
      await verifyExecutable(settings.cli);
      await mkdir(directory, { mode: 0o700 });
      await execute(
        settings.gateway,
        [
          "generate-certs",
          "--output-dir",
          join(directory, "tls"),
          "--server-san",
          "127.0.0.1",
          "--server-san",
          "localhost",
          "--server-san",
          "host.openshell.internal",
        ],
        { timeout: 30000 },
      );
      const mtls = join(
        directory,
        "config/openshell/gateways",
        settings.name,
        "mtls",
      );
      await mkdir(mtls, { recursive: true, mode: 0o700 });
      for (const [source, destination] of [
        ["ca.crt", "ca.crt"],
        ["client/tls.crt", "tls.crt"],
        ["client/tls.key", "tls.key"],
      ]) {
        if (!source || !destination)
          throw Error("Invalid certificate mapping.");
        await copyFile(join(directory, "tls", source), join(mtls, destination));
      }
      await writeFile(
        join(directory, "gateway.toml"),
        toml(directory, settings),
        { flag: "wx", mode: 0o600 },
      );
      await writeFile(
        join(directory, "controller.json"),
        JSON.stringify(settings, null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      await execute(
        settings.cli,
        [
          "gateway",
          "add",
          `https://127.0.0.1:${String(settings.port)}`,
          "--name",
          settings.name,
          "--local",
        ],
        { env, timeout: 15000 },
      );
      await protect(directory);
      process.stdout.write(
        "Controller initialized. Keep this directory private and persistent.\n",
      );
    },
  );
command
  .command("start")
  .requiredOption("--directory <path>", "Private controller directory")
  .action(async (options: { directory: string }) => {
    const directory = resolve(options.directory);
    const settings = await load(directory);
    await verifyExecutable(settings.gateway);
    const child = spawn(
      settings.gateway,
      ["--config", join(directory, "gateway.toml")],
      { env: environment(directory), stdio: "inherit" },
    );
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    const interrupt = () => forward("SIGINT"),
      terminate = () => forward("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          if (code === 0 || signal === "SIGINT" || signal === "SIGTERM")
            resolve();
          else reject(Error("Controller exited unsuccessfully."));
        });
      });
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
  });
await command.parseAsync();
