import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configure, parseInput } from "../../runtime/models.js";
import { nativeAssignments } from "../../scripts/models/configuration.js";
import { loadConfiguration } from "../../scripts/models/native.js";
import { configureRuntimeModels } from "../../scripts/models/runtime.js";
const configuration = await loadConfiguration(
  "deploy/models/config.example.json",
);
const input = {
  assignments: nativeAssignments(configuration),
  token: "sk-private",
  ca: null,
  apply: false,
};

await test("model input rejects unknown fields, unknown paths, duplicates and malformed assignment values", () => {
  assert.doesNotThrow(() => parseInput(input));
  for (const invalid of [
    { ...input, extra: true },
    { ...input, assignments: [...input.assignments, input.assignments[0]] },
    {
      ...input,
      assignments: [
        { path: "arbitrary.config", value: true },
        ...input.assignments,
      ],
    },
    {
      ...input,
      assignments: input.assignments.map((value) => ({
        ...value,
        extra: true,
      })),
    },
    {
      ...input,
      assignments: input.assignments.map((value) => ({
        ...value,
        value: null,
      })),
    },
  ])
    assert.throws(() => parseInput(invalid), { code: "invalid_input" });
});

await test("native validation failure is definitive; failed apply remains uncertain and retains credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-model-error-"));
  try {
    const executable = join(directory, "native");
    await writeFile(
      executable,
      `#!${process.execPath}\nprocess.stderr.write('secret-vendor-output'); process.exit(1);`,
      { mode: 0o700 },
    );
    await assert.rejects(
      configure(parseInput(input), { stateDirectory: directory, executable }),
      { code: "validation_rejected" },
    );
    assert.deepEqual(await readdir(join(directory, "clawscarf-models")), []);
    await assert.rejects(
      configure(parseInput({ ...input, apply: true }), {
        stateDirectory: directory,
        executable: join(directory, "missing"),
      }),
      { code: "unavailable" },
    );
    assert.deepEqual(await readdir(join(directory, "clawscarf-models")), []);
    await assert.rejects(
      configure(parseInput({ ...input, apply: true }), {
        stateDirectory: directory,
        executable,
      }),
      { code: "outcome_unknown" },
    );
    const files = await readdir(join(directory, "clawscarf-models"));
    assert.equal(files.length, 1);
    assert.ok(files[0]?.endsWith(".json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("controller preserves structured model failures and never replays an uncertain apply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-model-protocol-"));
  try {
    const keyFile = join(directory, "key");
    await writeFile(keyFile, "sk-runtime");
    const executable = join(directory, "openshell");
    for (const [wire, expected] of [
      [JSON.stringify({ ok: false, error: "invalid_input" }), "invalid_input"],
      [
        JSON.stringify({ ok: false, error: "validation_rejected" }),
        "validation_rejected",
      ],
      [
        JSON.stringify({ ok: false, error: "outcome_unknown" }),
        "outcome_unknown",
      ],
      [
        JSON.stringify({ ok: false, error: "unknown-vendor-secret" }),
        "outcome_unknown",
      ],
      ["", "outcome_unknown"],
    ]) {
      const calls = join(directory, "calls");
      await rm(calls, { force: true });
      await writeFile(
        executable,
        `#!${process.execPath}\nimport {appendFileSync} from 'node:fs'; for await (const chunk of process.stdin) {} appendFileSync(${JSON.stringify(calls)}, 'x'); process.stdout.write(${JSON.stringify(wire)}); process.exitCode = 1;`,
        { mode: 0o700 },
      );
      await assert.rejects(
        configureRuntimeModels({
          configuration,
          keyFile,
          openshell: executable,
          gateway: "team",
          sandbox: "team",
          apply: true,
        }),
        { code: expected },
      );
      assert.equal(await readFile(calls, "utf8"), "x");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
