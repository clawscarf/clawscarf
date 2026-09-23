import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { gt, valid } from "semver";
import { z } from "zod";
import { advanceRuntime } from "./advance-runtime.js";
import { releaseSchema } from "./definition.js";

const registrySchema = z.object({
  "dist-tags": z.record(z.string(), z.string()),
  versions: z.record(
    z.string(),
    z.object({ dist: z.object({ integrity: z.string() }) }),
  ),
});

/** Run before publishing any assets. A retry must refer to identical npm bytes and channel. */
export async function checkPublication(
  options: {
    current: string;
    expected: string;
    candidate: string;
    tarball: string;
  },
  request: typeof fetch = fetch,
) {
  await advanceRuntime({ ...options, checkOnly: true });
  const { version } = releaseSchema.parse(
    JSON.parse(await readFile(options.candidate, "utf8")),
  );
  const channel = version.includes("-") ? "next" : "latest";
  const response = await request(
    "https://registry.npmjs.org/@clawscarf%2fcli",
    {
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (response.status === 404) {
    await response.body?.cancel();
    return "publish";
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(
      `npm registry check failed (${String(response.status)}); nothing may be published.`,
    );
  }
  const registry = registrySchema.parse(await response.json());
  const selected = registry["dist-tags"][channel];
  if (selected && (!valid(selected) || gt(selected, version)))
    throw Error(
      `npm ${channel} already selects a newer version; refusing publication.`,
    );
  const existing = registry.versions[version];
  if (!existing) {
    if (selected === version)
      throw Error("npm channel references a missing version.");
    return "publish";
  }
  const integrity =
    "sha512-" +
    createHash("sha512")
      .update(await readFile(options.tarball))
      .digest("base64");
  if (existing.dist.integrity !== integrity)
    throw Error(
      "This npm version exists with different bytes; refusing replacement.",
    );
  if (selected !== version)
    throw Error(
      "The identical npm version exists, but its channel differs. Review the channel before retrying.",
    );
  return "already-published";
}

if (import.meta.main)
  await new Command("check-publication")
    .requiredOption("--current <file>", "Tracked runtime selection")
    .requiredOption(
      "--expected <file>",
      "Selection at the candidate source commit",
    )
    .requiredOption("--candidate <file>", "Verified candidate runtime manifest")
    .requiredOption("--tarball <file>", "Candidate npm tarball")
    .action(async (options: Parameters<typeof checkPublication>[0]) => {
      console.log(await checkPublication(options));
    })
    .parseAsync();
