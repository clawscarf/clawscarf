import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function snapshot(path: string): Promise<readonly [string, string][]> {
  const rows: [string, string][] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (file === "plugins/connections/generated/http") continue;
    if (entry.isDirectory()) rows.push(...(await snapshot(file)));
    else rows.push([file, await readFile(file, "utf8")]);
  }
  return rows.sort(([a], [b]) => a.localeCompare(b));
}

const capture = async () =>
  JSON.stringify(
    await Promise.all([
      snapshot("generated/http"),
      snapshot("services/cloud/generated"),
      snapshot("services/cloud/management/generated"),
      snapshot("services/connections/cloud/generated"),
      snapshot("services/access/generated"),
      snapshot("plugins/connections/generated"),
      snapshot("plugins/connections/openapi"),
    ]),
  );
const before = await capture();
execFileSync("pnpm", ["connections:management:generate"], { stdio: "inherit" });
execFileSync("pnpm", ["cloud:generate"], { stdio: "inherit" });
execFileSync("pnpm", ["cloud:management:generate"], { stdio: "inherit" });
execFileSync("pnpm", ["http:generate"], { stdio: "inherit" });
execFileSync("pnpm", ["access:generate"], { stdio: "inherit" });
execFileSync(
  "npm",
  ["--prefix", "plugins/connections", "run", "api:generate"],
  { stdio: "inherit" },
);
if (before !== (await capture())) {
  console.error(
    "Generated API files were stale. Review and commit the regenerated output.",
  );
  process.exitCode = 1;
}
