import { fileURLToPath } from "node:url";

/** Execute the same entry point from a contributor checkout or its compiled artifact. */
export function nodeEntrypoint(relative: string): string[] {
  const source = import.meta.url.endsWith(".ts");
  const file = new URL(relative + (source ? ".ts" : ".js"), import.meta.url);
  return [
    ...(source ? ["--import", import.meta.resolve("tsx")] : []),
    fileURLToPath(file),
  ];
}
