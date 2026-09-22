import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { Command } from "commander";
import { gt, valid } from "semver";
import { assertPublishedRuntime, releaseSchema } from "./definition.js";

/** Advance the checkout only from the pin against which this release was built. */
export async function advanceRuntime(options: {
  current: string;
  expected: string;
  candidate: string;
  checkOnly?: boolean;
}) {
  const read = async (file: string) =>
    releaseSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const candidate = await read(options.candidate);
  assertPublishedRuntime(candidate);
  const current = await read(options.current);
  if (isDeepStrictEqual(current, candidate)) return false;
  if (!isDeepStrictEqual(current, await read(options.expected)))
    throw Error(
      "Runtime selection changed since this candidate was built; refusing to overwrite it.",
    );
  if (
    !valid(candidate.version) ||
    !valid(current.version) ||
    !gt(candidate.version, current.version)
  )
    throw Error("Runtime selection must advance to a newer release version.");
  if (!options.checkOnly)
    await writeFile(options.current, JSON.stringify(candidate, null, 2) + "\n");
  return true;
}

if (import.meta.main)
  await new Command("advance-runtime")
    .requiredOption("--current <file>", "Tracked runtime selection")
    .requiredOption(
      "--expected <file>",
      "Selection at the candidate source commit",
    )
    .requiredOption("--candidate <file>", "Verified published runtime manifest")
    .action(
      async (options: {
        current: string;
        expected: string;
        candidate: string;
      }) => {
        console.log(
          (await advanceRuntime(options))
            ? "Runtime selection advanced."
            : "Runtime selection already matches.",
        );
      },
    )
    .parseAsync();
