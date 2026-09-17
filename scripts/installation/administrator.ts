import { z } from "zod";
import { compose } from "../local/compose.js";

/** Local operator command; no public endpoint can issue an ownership claim. */
export async function administratorSetup(directory: string, issue = false) {
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
    ],
    issue ? 30_000 : 3000,
  );
  return z
    .strictObject({
      complete: z.boolean(),
      expiresAt: z.string().nullable(),
      url: z.url().optional(),
    })
    .parse(JSON.parse(output));
}
