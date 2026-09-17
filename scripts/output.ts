import type { Command } from "commander";

/** Human output is deliberately not a scripting contract; use --json for that. */
export function writeResult(command: Command, value: unknown, human?: string) {
  const json = command.optsWithGlobals<{ json?: boolean }>().json;
  process.stdout.write(
    (json ? JSON.stringify(value, null, 2) : (human ?? describe(value))) + "\n",
  );
}

function describe(value: unknown, indent = ""): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.length
      ? value
          .map(
            (item: unknown) =>
              `${indent}- ${describe(item, indent + "  ").trimStart()}`,
          )
          .join("\n")
      : "None";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  )
    return String(value);
  if (typeof value !== "object") return "Unavailable";
  return Object.entries(value)
    .map(([key, item]: [string, unknown]) => {
      const label = key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replaceAll("_", " ");
      const nested =
        item !== null &&
        typeof item === "object" &&
        (!Array.isArray(item) || item.length > 0);
      return `${indent}${label.charAt(0).toUpperCase()}${label.slice(1)}:${nested ? "\n" : " "}${describe(item, nested ? indent + "  " : "")}`;
    })
    .join("\n");
}
