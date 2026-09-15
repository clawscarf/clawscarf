import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

/** Execute the same checked helper from source or a built operator. */
export async function browserOperatorSource() {
  const source = import.meta.url.endsWith(".ts");
  const text = await readFile(
    new URL(
      `../../deploy/execution/browser-node/operator.${source ? "ts" : "js"}`,
      import.meta.url,
    ),
    "utf8",
  );
  return (
    (source ? stripTypeScriptTypes(text) : text) +
    "\nawait runBrowserOperator();\n"
  );
}
