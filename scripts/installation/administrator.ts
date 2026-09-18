import { z } from "zod";
import { compose } from "../deployment/compose.js";

/** Local operator command; no public endpoint can issue an ownership claim. */
export async function administratorSetup(
  directory: string,
  issue = false,
  verify = false,
) {
  const output = await compose(
    directory,
    [
      "exec",
      "-T",
      "-e",
      "CLAWSCARF_ACCESS_CONFIG=/run/clawscarf/access.json",
      "companion",
      "node",
      "services/access/runtime/setup.js",
      ...(issue ? ["--issue"] : []),
      ...(verify ? ["--verify"] : []),
    ],
    issue || verify ? 60_000 : 3000,
  );
  return z
    .strictObject({
      complete: z.boolean(),
      expiresAt: z.string().nullable(),
      url: z.url().optional(),
    })
    .parse(JSON.parse(output));
}
