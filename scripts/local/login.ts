import { z } from "zod";
import { compose } from "./compose.js";
import * as access from "../../services/access/generated/client/sdk.gen.js";
import { LocalSetupError } from "./process.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensurePrivateFile, readState } from "./state.js";

export async function localLoginCode(directory: string) {
  if ((await readState(directory)).input.team)
    throw new LocalSetupError(
      "invalid_team_configuration",
      "Sign in through the configured company provider; team deployments do not issue local login codes.",
    );
  const output = await compose(directory, [
    "exec",
    "-T",
    "-e",
    "CLAWSCARF_ACCESS_CONFIG=/run/clawscarf/access.json",
    "companion",
    "node",
    "services/access/runtime/local-token.js",
    "--json",
  ]);
  return z
    .strictObject({ url: z.url(), code: z.string().min(1) })
    .parse(JSON.parse(output));
}
/** Uses the same one-use login and native-authorized REST path as the browser. */
export async function verifyLocalAdministrator(
  directory: string,
  origin: string,
  signal: AbortSignal,
  issueCode: typeof localLoginCode = localLoginCode,
) {
  const invitation = await issueCode(directory);
  const login = await access.localLogin({
    baseUrl: origin,
    body: { token: invitation.code },
    headers: { origin },
    redirect: "manual",
    throwOnError: true,
    signal,
  });
  const cookie = login.response.headers
    .getSetCookie()
    .find((value) => value.startsWith("clawscarf_session="))
    ?.split(";")[0];
  if (!cookie)
    throw new LocalSetupError(
      "administrator_unverified",
      "Local login did not establish an administrator session.",
    );
  let csrf: string | undefined;
  try {
    const current = await access.session({
      baseUrl: origin,
      headers: { cookie },
      throwOnError: true,
      signal,
    });
    csrf = current.data.csrfToken;
    await access.listPeople({
      baseUrl: origin,
      headers: { cookie },
      throwOnError: true,
      signal,
    });
    const { ownerId } = await readState(directory);
    const completed = join(directory, "native-bootstrap.json");
    try {
      z.strictObject({ ownerId: z.literal(ownerId) }).parse(
        JSON.parse(await readFile(completed, "utf8")),
      );
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      const intent = join(directory, "native-bootstrap-started.json");
      try {
        await readFile(intent);
        throw new LocalSetupError(
          "bootstrap_outcome_unknown",
          "Initial native setup was interrupted. Inspect native access before explicitly continuing; startup will not replay the change.",
        );
      } catch (missing) {
        if (!(
          missing instanceof Error &&
          "code" in missing &&
          missing.code === "ENOENT"
        ))
          throw missing;
      }
      const value = JSON.stringify({ ownerId });
      await ensurePrivateFile(intent, value);
      await access.prepareTeam({
        baseUrl: origin,
        headers: { cookie, origin, "x-csrf-token": csrf },
        signal,
        throwOnError: true,
      });
      await ensurePrivateFile(completed, value);
    }
  } finally {
    if (csrf)
      await access.logout({
        baseUrl: origin,
        headers: { cookie, origin, "x-csrf-token": csrf },
        redirect: "manual",
        throwOnError: true,
        signal: AbortSignal.timeout(10_000),
      });
  }
}
