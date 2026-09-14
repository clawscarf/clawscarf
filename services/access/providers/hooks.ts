import { z } from "zod";
/** RawClaw hook projection: exact native built-in URLs, never arbitrary plugin prefixes. */
const hooksSchema = z.object({
  enabled: z.boolean().optional(),
  token: z.unknown().optional(),
  path: z.string().optional(),
  presets: z.array(z.string()).optional(),
  mappings: z
    .array(
      z.object({ match: z.object({ path: z.string().optional() }).optional() }),
    )
    .optional(),
});
export function validHookPath(path: string): boolean {
  return (
    path.length <= 1024 &&
    /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(path) &&
    !path.startsWith("/_clawscarf") &&
    !path.startsWith("/__clawscarf")
  );
}
export function projectHookPaths(configuration: unknown): string[] {
  const { hooks } = z
    .object({ hooks: hooksSchema.optional() })
    .parse(configuration);
  if (!hooks?.enabled) return [];
  if (hooks.token === undefined || hooks.token === null || hooks.token === "")
    throw Error("Enabled native hooks require authentication.");
  const raw = hooks.path?.trim() || "/hooks";
  const base = (raw.startsWith("/") ? raw : `/${raw}`).replace(/\/+$/, "");
  const suffixes = ["wake", "agent"];
  if (hooks.presets?.includes("gmail")) suffixes.push("gmail");
  for (const mapping of hooks.mappings ?? []) {
    const path = mapping.match?.path?.trim().replace(/^\/+|\/+$/g, "");
    if (path) suffixes.push(path);
  }
  const paths = [
    ...new Set(suffixes.map((suffix) => `${base}/${suffix}`)),
  ].sort();
  if (paths.length > 98 || paths.some((path) => !validHookPath(path)))
    throw Error("Native hook paths cannot be published.");
  return paths;
}
