import { isBuiltin } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

/** Publisher-only check of the actual staged JavaScript, not a parallel dependency list. */
export async function runtimeDependencies(
  directory: string,
  entrypoints: readonly string[],
) {
  const dependencies = new Set<string>();
  const visited = new Set<string>();
  async function inspectFile(file: string): Promise<void> {
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const imports: string[] = [];
    function inspect(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imports.push(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const specifier = node.arguments[0];
        if (specifier && ts.isStringLiteral(specifier))
          imports.push(specifier.text);
        else
          throw Error(
            `Runtime dynamic import must have a verifiable target: ${relative(directory, file)}`,
          );
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
    for (const specifier of imports) {
      if (isBuiltin(specifier)) continue;
      if (specifier.startsWith(".")) {
        const target = resolve(dirname(file), specifier);
        const path = relative(directory, target);
        if (
          path.startsWith("../") ||
          path === ".." ||
          !(await stat(target).catch(() => undefined))?.isFile()
        )
          throw Error(
            `Missing runtime import: ${relative(directory, file)} -> ${specifier}`,
          );
        if (!target.endsWith(".json")) await inspectFile(target);
      } else {
        if (!/^(@[\w.-]+\/)?[\w.-]+(?:\/|$)/.test(specifier))
          throw Error(
            `Unsupported runtime import: ${relative(directory, file)} -> ${specifier}`,
          );
        dependencies.add(
          specifier
            .split("/")
            .slice(0, specifier.startsWith("@") ? 2 : 1)
            .join("/"),
        );
      }
    }
  }
  for (const entrypoint of entrypoints)
    await inspectFile(join(directory, entrypoint));
  return dependencies;
}
