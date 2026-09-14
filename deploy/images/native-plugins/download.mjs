import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import manifest from "./lobster.json" with { type: "json" };
const response = await globalThis.fetch(manifest.url, {
  redirect: "error",
  signal: globalThis.AbortSignal.timeout(60000),
});
if (!response.ok) throw Error("Official Lobster package download failed.");
const bytes = Buffer.from(await response.arrayBuffer());
if (
  `sha512-${createHash("sha512").update(bytes).digest("base64")}` !==
  manifest.integrity
)
  throw Error("Official Lobster package integrity mismatch.");
await writeFile("/tmp/lobster.tgz", bytes, { flag: "wx", mode: 0o600 });
