import type { ConnectorJson } from "../../types/catalog.js";

/** Provider file markers select transport capabilities without validating arguments. */
export function connectorFilePaths(
  schema: ConnectorJson,
  marker: "file_uploadable" | "file_downloadable",
): string[] {
  const found = new Set<string>();
  let remainingVisits = 250_000;
  const visit = (
    node: ConnectorJson,
    path: string,
    references: Set<string>,
  ): void => {
    if (--remainingVisits < 0)
      throw Error("Connector file guidance is too complex.");
    if (!record(node)) return;
    if (node[marker] === true) found.add(path);
    if (
      typeof node.$ref === "string" &&
      node.$ref.startsWith("#/") &&
      !references.has(node.$ref)
    ) {
      let target: ConnectorJson | undefined = schema;
      for (const key of node.$ref.slice(2).split("/")) {
        target = record(target)
          ? target[key.replaceAll("~1", "/").replaceAll("~0", "~")]
          : undefined;
      }
      if (target !== undefined)
        visit(target, path, new Set([...references, node.$ref]));
    }
    if (record(node.properties)) {
      for (const [key, value] of Object.entries(node.properties)) {
        visit(
          value,
          `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
          references,
        );
      }
    }
    if (record(node.items)) visit(node.items, `${path}/*`, references);
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      const branches = node[keyword];
      if (Array.isArray(branches))
        branches.forEach((branch) => visit(branch, path, references));
    }
  };
  visit(schema, "", new Set());
  return [...found].sort();
}

function record(
  value: ConnectorJson | undefined,
): value is { [key: string]: ConnectorJson } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
