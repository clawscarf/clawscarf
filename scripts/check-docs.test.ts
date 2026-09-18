import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { checkDocuments } from "./check-docs.js";

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-docs-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { check: "test", build: "test" } }),
  );
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { root, close: () => rm(root, { recursive: true, force: true }) };
}

await test("documentation checks resolve nested links, reference links, encoded paths and formatted duplicate headings", async () => {
  const f = await fixture({
    "README.md":
      "[guide](docs/guide.md#repeat-1)\n\n[code][source]\n\n[source]: src/server.ts\n\n```sh\npnpm check\npnpm run build\npnpm install --frozen-lockfile\npnpm exec playwright install chromium\npnpm link\npnpm add --global link:.\n```\n",
    "docs/guide.md":
      "# **Repeat**\n\n# Repeat\n\n[home](../README.md)\n\n[spaces](a%20file.md#file)\n\n`pnpm build`\n\n```ts\n// example.ts is sample code, not a source reference.\n```\n",
    "docs/a file.md": "# File\n",
    "src/server.ts": "export {};\n",
  });
  try {
    assert.deepEqual(
      await checkDocuments(f.root, ["README.md", "docs/guide.md"]),
      [],
    );
  } finally {
    await f.close();
  }
});

await test("documentation checks reject moved files, stale anchors, machine-local links and obsolete scripts", async () => {
  const f = await fixture({
    "README.md":
      "[moved](src/routes.ts)\n\n[heading](docs/guide.md#old-heading)\n\n[directory](docs)\n\n[local](/Users/example/clawscarf/src/server.ts)\n\n[outside](../outside.md)\n\n`authentication.ts`\n\n```sh\npnpm obsolete\n```\n\n`pnpm run removed`\n",
    "docs/guide.md": "# Current heading\n",
  });
  try {
    const failures = await checkDocuments(f.root, ["README.md"]);
    assert.equal(failures.length, 8);
    for (const expected of [
      "missing target",
      "missing heading",
      "not a directory",
      "source permalink",
      "leaves the repository",
      "unchecked code span",
      'unknown pnpm script "obsolete"',
      'unknown pnpm script "removed"',
    ])
      assert.ok(
        failures.some((failure) => failure.includes(expected)),
        expected,
      );
  } finally {
    await f.close();
  }
});

await test("the task checklist accepts open and deferred work but rejects completed tasks at any depth", async () => {
  const f = await fixture({
    "TODO.md":
      "# Remaining work\n\n- [ ] Pending acceptance\n  - [x] Completed subtask\n- [X] Completed batch\n\n## Future ideas\n\n- [ ] Optional integration\n\n```md\n- [x] Example syntax\n```\n",
  });
  try {
    assert.deepEqual(
      await checkDocuments(f.root, ["TODO.md"]),
      Array<string>(2).fill(
        "TODO.md: remove completed tasks from the implementation checklist",
      ),
    );
  } finally {
    await f.close();
  }
});
