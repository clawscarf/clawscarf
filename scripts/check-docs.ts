import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { Marked, Parser, TextRenderer } from "marked";
import GithubSlugger from "github-slugger";

const markdown = new Marked();
const textParser = new Parser();
const sourceFile =
  /^[\w.@][\w.@/-]*\.(?:[cm]?tsx?|md|json|ya?ml|css|sh|html|sql)$/;

/** References, commands and plan hygiene; behavioral claims still require review. */
export async function checkDocuments(root: string, files: readonly string[]) {
  const packageJson: unknown = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  );
  if (
    !packageJson ||
    typeof packageJson !== "object" ||
    !("scripts" in packageJson) ||
    !packageJson.scripts ||
    typeof packageJson.scripts !== "object"
  )
    throw Error("package.json must define scripts.");
  const scripts = new Set(Object.keys(packageJson.scripts));
  const failures: string[] = [];
  const documents = new Map<string, ReturnType<typeof markdown.lexer>>();
  const document = async (file: string) => {
    const cached = documents.get(file);
    if (cached) return cached;
    const parsed = markdown.lexer(await readFile(file, "utf8"));
    documents.set(file, parsed);
    return parsed;
  };
  for (const file of files) {
    const path = resolve(root, file);
    const links = new Set<string>();
    const report = (message: string) => failures.push(`${file}: ${message}`);
    const command = (value: string) => {
      const name = /^pnpm\s+(?:run\s+)?([\w:-]+)/.exec(value.trim())?.[1];
      if (name && !["install", "exec"].includes(name) && !scripts.has(name))
        report(`unknown pnpm script "${name}"`);
    };
    await Promise.all(
      markdown
        .walkTokens(await document(path), (token) => {
          if (
            file === "PLAN.md" &&
            token.type === "list_item" &&
            token.checked === true
          )
            report("remove completed tasks from the implementation checklist");
          if (
            (token.type === "link" ||
              token.type === "image" ||
              token.type === "def") &&
            typeof token.href === "string"
          )
            links.add(token.href);
          if (token.type === "codespan" && typeof token.text === "string") {
            if (sourceFile.test(token.text))
              report(
                `link source file "${token.text}" instead of using an unchecked code span`,
              );
            command(token.text);
          }
          if (
            token.type === "code" &&
            typeof token.text === "string" &&
            typeof token.lang === "string" &&
            ["sh", "shell", "bash", "console"].includes(token.lang)
          )
            token.text.split("\n").forEach(command);
        })
        .filter((result) => result instanceof Promise),
    );
    for (const href of links) {
      if (/^(?:https?:|mailto:)/i.test(href)) continue;
      if (isAbsolute(href) || /^[a-z][a-z\d+.-]*:/i.test(href)) {
        report(`use a repository-relative link or a source permalink: ${href}`);
        continue;
      }
      try {
        const url = new URL(href, "https://docs.invalid/");
        const pathname = decodeURIComponent(href.split(/[?#]/, 1)[0] ?? "");
        const target = pathname ? resolve(dirname(path), pathname) : path;
        const location = relative(root, target);
        if (location === ".." || location.startsWith("../")) {
          report(`link leaves the repository: ${href}`);
          continue;
        }
        const entry = await stat(target);
        if (!entry.isFile()) {
          report(`link to an owning file or README, not a directory: ${href}`);
          continue;
        }
        if (url.hash && extname(target) === ".md") {
          const slugger = new GithubSlugger();
          const headings = new Set<string>();
          await Promise.all(
            markdown
              .walkTokens(await document(target), (token) => {
                if (token.type === "heading" && token.tokens)
                  headings.add(
                    slugger.slug(
                      textParser.parseInline(token.tokens, new TextRenderer()),
                    ),
                  );
              })
              .filter((result) => result instanceof Promise),
          );
          if (!headings.has(decodeURIComponent(url.hash.slice(1))))
            report(`missing heading: ${href}`);
        }
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
          report(`missing target: ${href}`);
        else throw error;
      }
    }
  }
  return failures;
}

if (import.meta.main) {
  const root = process.cwd();
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((path) => path.endsWith(".md") && !path.endsWith("/LICENSE.md"));
  const failures = await checkDocuments(root, files);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `Documentation references, pnpm scripts and checklist hygiene passed (${String(files.length)} maintained documents).`,
    );
}
