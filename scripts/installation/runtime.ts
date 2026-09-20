import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { releaseSchema, releaseTools } from "../release/definition.js";
import { readJson, verifyReleaseTool } from "./files.js";
import { InstallationError } from "./errors.js";

/** Installation-owned paths survive npm cache cleanup and later CLI updates. */
export async function retainRuntime(source: string, directory: string) {
  const release = releaseSchema.parse(await readJson(source));
  const target = join(directory, "runtime");
  await mkdir(join(target, "tools"), { recursive: true, mode: 0o700 });
  for (const name of ["cli", "gateway"] as const) {
    const tool = releaseTools(release)[name];
    const original = resolve(dirname(source), tool.file);
    tool.file = `tools/openshell${name === "gateway" ? "-gateway" : ""}`;
    try {
      await verifyReleaseTool(original, tool.sha256);
      await copyFile(original, join(target, tool.file));
      await chmod(join(target, tool.file), 0o700);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT" &&
        tool.url
      ))
        throw error;
    }
  }
  await writeFile(
    join(target, "release.json"),
    JSON.stringify(release, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  return "./runtime/release.json";
}

/** Download only absent tools; corrupt or replaced executables always fail verification. */
export async function acquireRuntimeTools(
  releaseFile: string,
  options: {
    acquire?: boolean;
    report?: (message: string) => void;
    signal?: AbortSignal;
  },
) {
  const release = releaseSchema.parse(await readJson(releaseFile));
  for (const name of ["cli", "gateway"] as const) {
    options.signal?.throwIfAborted();
    const tool = releaseTools(release)[name];
    const file = resolve(dirname(releaseFile), tool.file);
    try {
      await verifyReleaseTool(file, tool.sha256);
      continue;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    if (!options.acquire || !tool.url)
      throw new InstallationError(
        "release_mismatch",
        `The OpenShell ${name} is missing. ${tool.url ? "Run configure to download it." : "This development runtime requires its locally prepared tools."}`,
      );
    options.report?.(
      `Downloading OpenShell ${name} ${release.tools.openshell.version}`,
    );
    const temporary = `${file}.${randomUUID()}.part`;
    const signal = AbortSignal.any([
      AbortSignal.timeout(5 * 60_000),
      ...(options.signal ? [options.signal] : []),
    ]);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    try {
      const response = await fetch(tool.url, { signal }).catch(() => {
        options.signal?.throwIfAborted();
        throw new InstallationError(
          "unavailable",
          `Could not download OpenShell ${name}. Check network access and retry configure.`,
        );
      });
      if (
        !response.ok ||
        !response.body ||
        new URL(response.url).protocol !== "https:"
      )
        throw new InstallationError(
          "unavailable",
          `Could not download OpenShell ${name}. Check network access and retry configure.`,
        );
      const output = await open(temporary, "wx", 0o700);
      try {
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > 256 * 1024 * 1024)
            throw new InstallationError(
              "release_mismatch",
              "Runtime tool download exceeds its size limit.",
            );
          await output.writeFile(chunk);
        }
      } finally {
        await output.close();
      }
      await verifyReleaseTool(temporary, tool.sha256);
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
