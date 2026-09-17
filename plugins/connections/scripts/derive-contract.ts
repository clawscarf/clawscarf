import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stringify } from "yaml";

type ObjectValue = Record<string, unknown>;
const methods = new Set([
  "get",
  "put",
  "post",
  "delete",
  "patch",
  "head",
  "options",
  "trace",
]);
function isObject(value: unknown): value is ObjectValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function object(value: unknown): ObjectValue {
  if (!isObject(value)) throw new Error("Expected an OpenAPI object.");
  return value;
}

/** The service owns operations; the portable artifact includes its bearer-authenticated runtime API. */
export function deriveBrokerContract(source: unknown) {
  const contract = object(source);
  const prefix = contract["x-clawscarf-broker-base-path"];
  if (
    typeof prefix !== "string" ||
    !prefix.startsWith("/") ||
    prefix.endsWith("/")
  )
    throw new Error("The service contract must declare its broker base path.");
  const security = contract["x-clawscarf-runtime-security"];
  if (typeof security !== "string")
    throw Error("Runtime security scheme is missing.");
  const components = object(contract.components);
  const paths: Record<string, ObjectValue> = {};
  for (const [path, entry] of Object.entries(object(contract.paths))) {
    const item = object(entry);
    const selected: ObjectValue = {};
    for (const [method, value] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      const operation = object(value);
      if (
        !Array.isArray(operation.security) ||
        !operation.security.some((requirement: unknown) =>
          Object.hasOwn(object(requirement), security),
        )
      )
        continue;
      if (!path.startsWith(`${prefix}/`))
        throw new Error(
          "Runtime operation is outside the declared broker base path.",
        );
      selected[method] = operation;
    }
    if (!Object.keys(selected).length) continue;
    if (item.parameters !== undefined) selected.parameters = item.parameters;
    paths[path.slice(prefix.length)] = selected;
  }
  if (!Object.keys(paths).length)
    throw new Error("The service contract has no runtime operations.");
  const selectedComponents: Record<string, ObjectValue> = {
    securitySchemes: {
      [security]: object(components.securitySchemes)[security],
    },
  };
  const visited = new Set<string>();
  function collect(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) collect(child);
      return;
    }
    const fields = object(value);
    if (typeof fields.$ref === "string") {
      const match = /^#\/components\/([^/]+)\/([^/]+)$/u.exec(fields.$ref);
      const category = match?.[1];
      const name = match?.[2];
      if (!category || !name)
        throw new Error(`Unsupported contract reference: ${fields.$ref}`);
      if (visited.has(fields.$ref)) return;
      visited.add(fields.$ref);
      const component = object(components[category])[name];
      if (component === undefined)
        throw new Error(`Missing contract reference: ${fields.$ref}`);
      (selectedComponents[category] ??= {})[name] = component;
      collect(component);
    }
    for (const child of Object.values(fields)) collect(child);
  }
  collect(paths);
  return {
    openapi: contract.openapi,
    info: {
      ...object(contract.info),
      title: "ClawScarf Connections broker runtime API",
    },
    paths,
    components: selectedComponents,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const source: unknown = JSON.parse(
    await readFile(
      new URL("../../../services/cloud/openapi.json", import.meta.url),
      "utf8",
    ),
  );
  await writeFile(
    new URL("../openapi/broker.yaml", import.meta.url),
    "# Generated from services/cloud/openapi.json; do not edit.\n" +
      stringify(deriveBrokerContract(source)),
  );
  execFileSync(
    "pnpm",
    [
      "exec",
      "prettier",
      "--write",
      fileURLToPath(new URL("../openapi/broker.yaml", import.meta.url)),
    ],
    {
      cwd: new URL("../../../", import.meta.url),
      stdio: "inherit",
    },
  );
}
