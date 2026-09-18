import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configure, parseInput } from "../../runtime/models.js";
import {
  nativeAssignments,
  configurationSchema,
} from "../../scripts/models/configuration.js";
import { configureStoppedRuntimeModels } from "../../scripts/models/runtime.js";
const configuration = configurationSchema.parse(
  JSON.parse(await readFile("deploy/models/config.example.json", "utf8")),
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
    await writeFile(join(directory, "openclaw.json"), "{}");
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

await test("stopped model helper preserves definitive failures and treats missing packaging as preflight failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-stopped-models-"));
  const oldPath = process.env.PATH;
  try {
    process.env.PATH = `${directory}:${oldPath ?? ""}`;
    for (const [wire, apply, expected] of [
      [
        JSON.stringify({ ok: false, error: "invalid_input" }),
        true,
        "invalid_input",
      ],
      [
        JSON.stringify({ ok: false, error: "unknown-vendor-secret" }),
        true,
        "outcome_unknown",
      ],
      [
        JSON.stringify({ ok: false, error: "validation_rejected" }),
        true,
        "validation_rejected",
      ],
      [
        JSON.stringify({ ok: false, error: "outcome_unknown" }),
        true,
        "outcome_unknown",
      ],
      ["", false, "unavailable"],
      ["", true, "outcome_unknown"],
    ] as const) {
      const calls = join(directory, "calls");
      await rm(calls, { force: true });
      await writeFile(
        join(directory, "docker"),
        `#!${process.execPath}\nimport {appendFileSync} from 'node:fs'; for await (const chunk of process.stdin) {} appendFileSync(${JSON.stringify(calls)}, 'x'); process.stdout.write(${JSON.stringify(wire)}); process.stderr.write('private-dependency-output'); process.exitCode = 1;`,
        { mode: 0o700 },
      );
      await assert.rejects(
        configureStoppedRuntimeModels({
          configuration,
          image: "test",
          volume: "test",
          credential: { token: "sk-private" },
          apply,
        }),
        { code: expected },
      );
      assert.equal(await readFile(calls, "utf8"), "x");
    }
    await rm(join(directory, "docker"));
    process.env.PATH = directory;
    await assert.rejects(
      configureStoppedRuntimeModels({
        configuration,
        image: "test",
        volume: "test",
        credential: { token: "sk-private" },
        apply: true,
      }),
      { code: "unavailable" },
    );
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    await rm(directory, { recursive: true, force: true });
  }
});

await test("explicit model recovery observes matching managed fields without invoking native mutation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cs-model-resume-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const managed = join(directory, "clawscarf-models");
  await mkdir(managed, { mode: 0o700 });
  const credential = join(managed, "existing.json");
  await writeFile(
    credential,
    JSON.stringify({ token: input.token, ca: null }),
    { mode: 0o600 },
  );
  const provider = parseInput(input).assignments.find(
    (item) => item.path === "models.providers.clawscarf",
  );
  const primary = input.assignments.find(
    (item) => item.path === "agents.defaults.model.primary",
  );
  assert.ok(provider && primary);
  const native = {
    secrets: {
      providers: {
        "clawscarf-models": { source: "file", mode: "json", path: credential },
      },
    },
    models: {
      providers: {
        clawscarf: {
          ...provider.value,
          apiKey: {
            source: "file",
            provider: "clawscarf-models",
            id: "/token",
          },
        },
      },
    },
    agents: { defaults: { model: { primary: primary.value } } },
  };
  const applied = parseInput({
    ...input,
    apply: true,
    assignments: input.assignments,
  });
  await writeFile(join(directory, "openclaw.json"), JSON.stringify(native), {
    mode: 0o600,
  });
  const before = await readFile(join(directory, "openclaw.json"));
  assert.equal(
    await configure(applied, {
      stateDirectory: directory,
      executable: join(directory, "missing"),
    }),
    "configured",
  );
  assert.deepEqual(await readFile(join(directory, "openclaw.json")), before);
  assert.deepEqual(await readdir(managed), ["existing.json"]);
  await writeFile(credential, JSON.stringify({ token: "changed", ca: null }));
  await assert.rejects(
    configure(applied, {
      stateDirectory: directory,
      executable: join(directory, "missing"),
    }),
    { code: "unavailable" },
  );
});
