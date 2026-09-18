import { session } from "../services/access/generated/sdk.gen.js";
import { cloudUrlSchema } from "./cloud/url.js";
import { readInputFile } from "./installation/files.js";
import { InstallationError } from "./installation/errors.js";

/** One bounded, non-redirecting authenticated operation for both management clients. */
export async function sessionRequest(options: {
  origin?: string;
  sessionFile?: string;
}) {
  if (!options.origin || !options.sessionFile)
    throw new InstallationError(
      "invalid_configuration",
      "Use --origin and --session-file for application management.",
    );
  const origin = cloudUrlSchema.parse(options.origin);
  const token = (await readInputFile(options.sessionFile, true))
    .toString("utf8")
    .trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token))
    throw new InstallationError(
      "invalid_configuration",
      "Invalid session credential.",
    );
  const base = {
    baseUrl: origin,
    redirect: "error",
    signal: AbortSignal.timeout(90_000),
    throwOnError: true,
    headers: { cookie: `clawscarf_session=${token}`, origin },
  } as const;
  const current = (await session(base)).data;
  return {
    ...base,
    headers: { ...base.headers, "x-csrf-token": current.csrfToken },
  };
}
