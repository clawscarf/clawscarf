import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const directory = join(root, ".local/artifact");
await mkdir(directory, { recursive: true });
const temporary = await mkdtemp(join(root, ".local/packing-"));
try {
  await execute(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", temporary],
    { cwd: root, maxBuffer: 4 * 1024 * 1024 },
  );
  /** @type {unknown} */
  const item = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const files = await readdir(temporary);
  const filename = files[0];
  if (files.length !== 1 || !filename || !/^[a-z0-9.-]+\.tgz$/.test(filename))
    throw new Error("Expected one connector package.");
  if (
    !item ||
    typeof item !== "object" ||
    !("name" in item) ||
    item.name !== "@clawscarf/connections" ||
    !("version" in item) ||
    typeof item.version !== "string"
  )
    throw new Error("Unexpected connector package metadata.");
  const bytes = await readFile(join(temporary, filename));
  await writeFile(
    join(temporary, "manifest.json"),
    `${JSON.stringify(
      {
        pluginId: "clawscarf-connections",
        version: item.version,
        packageSha256: createHash("sha256").update(bytes).digest("hex"),
      },
      null,
      2,
    )}\n`,
  );
  await rename(join(temporary, filename), join(directory, "connectors.tgz"));
  await rename(
    join(temporary, "manifest.json"),
    join(directory, "manifest.json"),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
