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
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const execute = promisify(execFile);
type Assignment = { path: string; value: unknown };
type Input = {
  assignments: Assignment[];
  token: string;
  ca: string | null;
  apply: boolean;
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseInput(value: unknown): Input {
  if (
    !record(value) ||
    !Array.isArray(value.assignments) ||
    typeof value.token !== "string" ||
    !value.token.trim() ||
    value.token.length > 65536 ||
    !(value.ca === null || typeof value.ca === "string") ||
    typeof value.apply !== "boolean"
  )
    throw Error("Invalid model configuration input.");
  const assignments = value.assignments.map((entry: unknown) => {
    if (
      !record(entry) ||
      typeof entry.path !== "string" ||
      ![
        "secrets.providers.clawscarf-models",
        "models.providers.clawscarf",
        "agents.defaults.model.primary",
        "agents.defaults.thinkingDefault",
      ].includes(entry.path)
    )
      throw Error("Invalid model assignment.");
    return { path: entry.path, value: entry.value };
  });
  if (
    assignments.filter((entry) => entry.path === "models.providers.clawscarf")
      .length !== 1 ||
    assignments.filter(
      (entry) => entry.path === "secrets.providers.clawscarf-models",
    ).length !== 1 ||
    new Set(assignments.map((entry) => entry.path)).size !== assignments.length
  )
    throw Error("Invalid model assignments.");
  return {
    assignments,
    token: value.token.trim(),
    ca: value.ca,
    apply: value.apply,
  };
}
export async function configure(
  input: Input,
  options: { stateDirectory: string; executable: string },
) {
  const directory = join(options.stateDirectory, "clawscarf-models");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0)
    throw Error("Model credential directory must be private.");
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
      if (!record(entry.value)) throw Error("Invalid provider settings.");
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
  let dispatched = false;
  try {
    await writeFile(batch, JSON.stringify(assignments), {
      flag: "wx",
      mode: 0o600,
    });
    dispatched = true;
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
    );
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
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    let text = "";
    for await (const chunk of process.stdin) {
      text += String(chunk);
      if (text.length > 1024 * 1024)
        throw Error("Model configuration is too large.");
    }
    const value: unknown = JSON.parse(text);
    const result = await configure(parseInput(value), {
      stateDirectory: "/home/node/.openclaw",
      executable: "/app/clawscarf/bin/openclaw",
    });
    process.stdout.write(`${result}\n`);
  } catch {
    process.stderr.write(
      "Model configuration failed; inspect native settings before retrying an apply.\n",
    );
    process.exitCode = 1;
  }
}
