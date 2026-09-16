import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const command = resolve(
  "node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
);

await test("independent companion and plugin imports pass; cross-boundary source imports fail", async () => {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-boundaries-"));
  try {
    for (const [path, content] of Object.entries({
      ".dependency-cruiser.cjs": await readFile(
        ".dependency-cruiser.cjs",
        "utf8",
      ),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" },
      }),
      "plugins/connections/src/index.ts":
        'import { value } from "./value.js"; export { value };',
      "plugins/connections/src/value.ts": "export const value = 1;",
      "services/access/entry.ts":
        'import { value } from "./value.js"; export { value };',
      "services/access/value.ts": "export const value = 2;",
    })) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    const args = [
      command,
      "plugins",
      "services",
      "--config",
      ".dependency-cruiser.cjs",
    ];
    await run(process.execPath, args, { cwd: root });
    await writeFile(
      join(root, "plugins/connections/src/index.ts"),
      'export { value } from "../../../services/access/value.js";',
    );
    await assert.rejects(
      run(process.execPath, args, { cwd: root }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok("stdout" in error && typeof error.stdout === "string");
        assert.match(
          error.stdout,
          /plugins-use-protocols-not-companion-internals/,
        );
        return true;
      },
    );
    await writeFile(
      join(root, "plugins/connections/src/index.ts"),
      'export { value } from "./value.js";',
    );
    await writeFile(
      join(root, "services/access/entry.ts"),
      'export { value } from "../../plugins/connections/src/value.js";',
    );
    await assert.rejects(
      run(process.execPath, args, { cwd: root }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok("stdout" in error && typeof error.stdout === "string");
        assert.match(
          error.stdout,
          /companions-do-not-import-plugin-or-tooling-internals/,
        );
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("domain layers and the public access seam enforce allowed and forbidden imports", async () => {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-layers-"));
  const write = async (path: string, contents: string) => {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  };
  try {
    await write(
      ".dependency-cruiser.cjs",
      await readFile(".dependency-cruiser.cjs", "utf8"),
    );
    await write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" },
      }),
    );
    for (const file of [
      "types/port",
      "service/work",
      "repo/store",
      "providers/vendor",
      "runtime/entry",
    ])
      await write(`services/connections/${file}.ts`, "export const value = 1;");
    await write("services/access/types/native.ts", "export const value = 1;");
    await write("services/access/repo/private.ts", "export const value = 1;");
    await write("runtime/preset.ts", "export const value = 1;");
    await write("apps/companion/entry.ts", "export const value = 1;");
    await write(
      "services/access/runtime/composition.ts",
      "export const value = 1;",
    );
    const args = [
      command,
      "apps",
      "services",
      "runtime",
      "--config",
      ".dependency-cruiser.cjs",
    ];
    const cases: Array<[string, string, string, string]> = [
      [
        "service/work",
        "../types/port.js",
        "../providers/vendor.js",
        "connections-services-use-ports",
      ],
      [
        "providers/vendor",
        "../types/port.js",
        "../repo/store.js",
        "connections-providers-use-domain-ports",
      ],
      [
        "repo/store",
        "../types/port.js",
        "../service/work.js",
        "connections-repositories-own-sql-only",
      ],
      [
        "types/port",
        "./local.js",
        "../runtime/entry.js",
        "connections-types-are-framework-free",
      ],
      [
        "runtime/entry",
        "../../access/types/native.js",
        "../../access/repo/private.js",
        "connections-use-access-public-boundary",
      ],
    ];
    await write(
      "services/connections/types/local.ts",
      "export const value = 1;",
    );
    for (const [source, allowed, forbidden, rule] of cases) {
      const file = `services/connections/${source}.ts`;
      await write(file, `export { value } from "${allowed}";`);
      await run(process.execPath, args, { cwd: root });
      await write(file, `export { value } from "${forbidden}";`);
      await assert.rejects(
        run(process.execPath, args, { cwd: root }),
        (error: unknown) => {
          assert.ok(
            error instanceof Error &&
              "stdout" in error &&
              typeof error.stdout === "string",
          );
          assert.ok(error.stdout.includes(rule), error.stdout);
          return true;
        },
      );
      await write(file, "export const value = 1;");
    }
    await write(
      "apps/companion/entry.ts",
      'export {value} from "../../services/access/runtime/composition.js";',
    );
    await run(process.execPath, args, { cwd: root });
    await write(
      "apps/companion/entry.ts",
      'export {value} from "../../services/access/repo/private.js";',
    );
    await assert.rejects(
      run(process.execPath, args, { cwd: root }),
      (error: unknown) => {
        assert.ok(
          error instanceof Error &&
            "stdout" in error &&
            typeof error.stdout === "string",
        );
        assert.ok(
          error.stdout.includes(
            "companion-app-uses-named-composition-boundaries",
          ),
        );
        return true;
      },
    );
    await write("apps/companion/entry.ts", "export const value = 1;");
    await write(
      "services/access/repo/private.ts",
      'export {value} from "../../../apps/companion/entry.js";',
    );
    await assert.rejects(
      run(process.execPath, args, { cwd: root }),
      (error: unknown) => {
        assert.ok(
          error instanceof Error &&
            "stdout" in error &&
            typeof error.stdout === "string",
        );
        assert.ok(
          error.stdout.includes("components-do-not-import-process-apps"),
        );
        return true;
      },
    );
    await write("services/access/repo/private.ts", "export const value = 1;");
    await write(
      "services/connections/service/work.ts",
      'import {readFile} from "node:fs/promises"; export {readFile};',
    );
    await assert.rejects(
      run(process.execPath, args, { cwd: root }),
      (error: unknown) => {
        assert.ok(
          error instanceof Error &&
            "stdout" in error &&
            typeof error.stdout === "string",
        );
        assert.ok(error.stdout.includes("connections-domain-has-no-direct-io"));
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("operator and shared UI boundaries cover allowed imports and reject reverse dependencies", async () => {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-operator-boundaries-"));
  const write = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  try {
    await write(
      ".dependency-cruiser.cjs",
      await readFile(".dependency-cruiser.cjs", "utf8"),
    );
    await write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" },
      }),
    );
    const files = [
      "scripts/installation/command",
      "scripts/local/prepare",
      "scripts/clawscarf",
      "ui/button",
      "services/access/web/page",
      "services/access/repo/postgres",
      "services/access/repo/private",
    ];
    for (const file of files)
      await write(`${file}.ts`, "export const value = 1;");
    const args = [
      command,
      "scripts",
      "services",
      "ui",
      "--config",
      ".dependency-cruiser.cjs",
    ];
    for (const [source, allowed, forbidden, rule] of [
      [
        "scripts/local/prepare",
        "../../services/access/repo/postgres.js",
        "../../services/access/repo/private.js",
        "operator-services-use-named-boundaries",
      ],
      [
        "scripts/local/prepare",
        "../../services/access/repo/postgres.js",
        "../installation/command.js",
        "component-operators-do-not-import-installation-ui",
      ],
      [
        "scripts/installation/command",
        "../local/prepare.js",
        "../clawscarf.js",
        "operator-internals-do-not-import-cli-entries",
      ],
      [
        "ui/button",
        "./input.js",
        "../services/access/web/page.js",
        "shared-ui-is-domain-independent",
      ],
      [
        "services/access/repo/postgres",
        "./private.js",
        "../../../ui/button.js",
        "only-web-imports-shared-ui",
      ],
    ] as const) {
      await write("ui/input.ts", "export const value = 1;");
      await write(`${source}.ts`, `export {value} from "${allowed}";`);
      await run(process.execPath, args, { cwd: root });
      await write(`${source}.ts`, `export {value} from "${forbidden}";`);
      await assert.rejects(
        run(process.execPath, args, { cwd: root }),
        (error: unknown) => {
          assert.ok(
            error instanceof Error &&
              "stdout" in error &&
              typeof error.stdout === "string",
          );
          assert.ok(error.stdout.includes(rule), error.stdout);
          return true;
        },
      );
      await write(`${source}.ts`, "export const value = 1;");
    }
    await write(
      "services/access/web/page.ts",
      'export {value} from "../../../ui/button.js";',
    );
    await run(process.execPath, args, { cwd: root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
