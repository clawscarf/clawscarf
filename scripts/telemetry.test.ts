import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import { Command } from "commander";
import { z } from "zod";
import { prepareProductTelemetry } from "./product-telemetry.js";
import { CliTelemetry } from "./telemetry.js";

const eventSchema = z.object({
  event: z.enum([
    "cli_command_started",
    "cli_command_finished",
    "installation_setup_completed",
  ]),
  distinct_id: z.union([
    z.uuid(),
    z.string().regex(/^installation:[0-9a-f-]{36}$/),
  ]),
  timestamp: z.iso.datetime(),
  properties: z.record(z.string(), z.unknown()),
});
type Event = z.infer<typeof eventSchema>;

async function fixture(
  t: TestContext,
  response: "ok" | "error" | "hang" = "ok",
) {
  const root = await mkdtemp(join(tmpdir(), "clawscarf-telemetry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events: Event[] = [];
  const requests: string[] = [];
  const server = createServer((request, res) => {
    requests.push(request.url ?? "");
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = z
        .object({ api_key: z.literal("phc_test"), batch: z.array(eventSchema) })
        .parse(JSON.parse(body));
      events.push(...payload.batch);
      if (response === "hang") return;
      res.writeHead(response === "error" ? 503 : 200);
      res.end(
        response === "error" ? "sensitive upstream response" : '{"status":1}',
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const destination = pathToFileURL(join(root, "destination.json"));
  await writeFile(
    destination,
    JSON.stringify({
      host: `http://127.0.0.1:${String(address.port)}`,
      projectToken: "phc_test",
    }),
  );
  const environment = { XDG_CONFIG_HOME: join(root, "config") };
  return { root, destination, environment, events, requests };
}

function command(telemetry: CliTelemetry, name: string) {
  const root = new Command("clawscarf").exitOverride();
  root.hook("preAction", async (_root, action) => telemetry.start(action));
  return root
    .command(name)
    .option("--directory <path>")
    .option("--delete")
    .option("--non-interactive");
}

await test("real PostHog requests pair invocations, retain local identity, and exclude inputs and results", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 2; i++) {
    const telemetry = new CliTelemetry(f.environment, f.destination);
    const cmd = command(telemetry, "configure");
    cmd.action(() => {
      telemetry.configurationMode(i === 0 ? "new" : "edit");
      telemetry.result({
        state: i === 0 ? "prepared" : "unchanged",
        directory: "/private/secret",
        credential: "secret-key",
        url: "https://private/?token=secret",
      });
    });
    await cmd.parent?.parseAsync(
      ["configure", "--directory", "/private/secret", "--non-interactive"],
      { from: "user" },
    );
    await telemetry.finish(0);
  }
  assert.equal(f.events.length, 4);
  assert.equal(new Set(f.events.map((event) => event.distinct_id)).size, 1);
  assert.equal(
    new Set(f.events.map((event) => event.properties.invocation_id)).size,
    2,
  );
  assert.ok(f.requests.every((url) => url === "/batch/"));
  const finishes = f.events.filter(
    (event) => event.event === "cli_command_finished",
  );
  assert.deepEqual(
    finishes.map((event) => event.properties.configuration_mode),
    ["new", "edit"],
  );
  assert.deepEqual(
    finishes.map((event) => event.properties.configuration_outcome),
    ["saved", "unchanged"],
  );
  for (const event of f.events) {
    assert.equal(event.properties.command, "configure");
    assert.equal(event.properties.interactive, false);
    assert.equal(event.properties.$geoip_disable, true);
    assert.equal(event.properties.$process_person_profile, false);
    assert.equal(event.properties.$ip, null);
    assert.equal(event.properties.os, process.platform);
    assert.equal(event.properties.architecture, process.arch);
    assert.equal(event.properties.cli_version, "0.0.0");
    for (const key of Object.keys(event.properties)) {
      assert.ok(
        [
          "command",
          "invocation_id",
          "cli_version",
          "os",
          "architecture",
          "interactive",
          "outcome",
          "duration_ms",
          "configuration_mode",
          "configuration_outcome",
          "$process_person_profile",
          "$ip",
          "$geoip_disable",
          "$lib",
          "$lib_version",
        ].includes(key),
        key,
      );
    }
  }
  for (const event of finishes) {
    assert.equal(event.properties.outcome, "success");
    assert.ok(
      typeof event.properties.duration_ms === "number" &&
        event.properties.duration_ms >= 0,
    );
    assert.equal(
      f.events.filter(
        (other) =>
          other.properties.invocation_id === event.properties.invocation_id,
      ).length,
      2,
    );
  }
  assert.doesNotMatch(JSON.stringify(f.events), /secret|private|credential/);
  assert.equal(
    (
      await stat(
        join(f.environment.XDG_CONFIG_HOME, "clawscarf", "telemetry-id"),
      )
    ).mode & 0o777,
    0o600,
  );
});

await test("cancellation, action required, readiness and failures are distinct; stop and delete stay separate", async (t) => {
  const f = await fixture(t);
  const cases = [
    {
      name: "configure",
      result: { state: "cancelled" },
      exit: 0,
      outcome: "cancelled",
    },
    {
      name: "configure",
      result: { state: "action_required", url: "private" },
      exit: 0,
      outcome: "action_required",
    },
    {
      name: "configure",
      result: { state: "running", ready: true },
      exit: 0,
      outcome: "success",
    },
    {
      name: "start",
      result: { state: "degraded", ready: false },
      exit: 0,
      outcome: "action_required",
    },
    {
      name: "status",
      result: { state: "stopped", ready: false },
      exit: 0,
      outcome: "success",
    },
    { name: "stop", result: {}, exit: 0, outcome: "success" },
    { name: "stop", result: {}, exit: 130, outcome: "cancelled", delete: true },
    {
      name: "start",
      result: {},
      exit: 1,
      outcome: "failure",
      code: "command_failed",
    },
    {
      name: "start",
      result: {},
      exit: 1,
      outcome: "failure",
      code: "secret-user@example.com",
    },
  ];
  for (const row of cases) {
    const telemetry = new CliTelemetry(f.environment, f.destination);
    const cmd = command(telemetry, row.name);
    cmd.action(() => {
      telemetry.result(row.result);
    });
    await cmd.parent?.parseAsync(
      [row.name, ...(row.delete ? ["--delete"] : [])],
      { from: "user" },
    );
    await telemetry.finish(row.exit, row.code);
    const last = f.events.at(-1);
    assert.ok(last);
    assert.equal(last.properties.outcome, row.outcome);
    if (row.name === "stop")
      assert.equal(last.properties.action, row.delete ? "delete" : "stop");
    if (row.outcome === "failure") {
      assert.equal(
        last.properties.error_code,
        row.code === "command_failed" ? row.code : "operation_failed",
      );
      assert.equal(last.properties.operation, "start");
    }
    if (row.name === "configure" && row.outcome === "success")
      assert.equal(last.properties.configuration_outcome, "ready");
  }
  assert.doesNotMatch(JSON.stringify(f.events), /secret-user|private/);
});

await test("nested commands report their registered names, never positional arguments", async (t) => {
  const f = await fixture(t);
  const telemetry = new CliTelemetry(f.environment, f.destination);
  const parent = command(telemetry, "people");
  parent.command("revoke <id>").action(() => {});
  await parent.parent?.parseAsync(["people", "revoke", "secret-person-id"], {
    from: "user",
  });
  await telemetry.finish(0);
  assert.equal(f.events[0]?.properties.command, "people revoke");
  assert.doesNotMatch(JSON.stringify(f.events), /secret-person-id/);
});

await test("opt-out precedes destination and identity access; missing or corrupt config/state leaves commands usable", async (t) => {
  const f = await fixture(t);
  const original = await readFile(f.destination, "utf8");
  const disabled = new CliTelemetry(
    { ...f.environment, CLAWSCARF_TELEMETRY_DISABLED: "1" },
    f.destination,
  );
  await disabled.start(command(disabled, "start"));
  await disabled.finish(1, "command_failed");
  assert.equal(f.events.length, 0);
  await assert.rejects(stat(f.environment.XDG_CONFIG_HOME), { code: "ENOENT" });
  for (const content of [
    "null",
    "not json",
    '{"host":"https://example.com","projectToken":"phx_secret"}',
  ]) {
    await writeFile(f.destination, content);
    const telemetry = new CliTelemetry(f.environment, f.destination);
    await telemetry.start(command(telemetry, "start"));
    await telemetry.finish(0);
  }
  await assert.rejects(stat(f.environment.XDG_CONFIG_HOME), { code: "ENOENT" });
  await writeFile(f.destination, original);
  const broken = new CliTelemetry(
    { XDG_CONFIG_HOME: join(f.root, "destination.json") },
    f.destination,
  );
  await broken.start(command(broken, "start"));
  await broken.finish(0);
  assert.equal(f.requests.length, 0);
  const enabled = new CliTelemetry(f.environment, f.destination);
  await enabled.start(command(enabled, "recipes"));
  await enabled.finish(0);
  const count = f.requests.length;
  await writeFile(
    join(f.environment.XDG_CONFIG_HOME, "clawscarf", "telemetry-id"),
    "private-corrupt-id",
  );
  const corrupt = new CliTelemetry(f.environment, f.destination);
  await corrupt.start(command(corrupt, "recipes"));
  await corrupt.finish(0);
  assert.equal(f.requests.length, count);
});

await test("concurrent CLI invocations preserve a single random identity", async (t) => {
  const f = await fixture(t);
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      const telemetry = new CliTelemetry(f.environment, f.destination);
      await telemetry.start(command(telemetry, "recipes"));
      await telemetry.finish(0);
    }),
  );
  const id = (
    await readFile(
      join(f.environment.XDG_CONFIG_HOME, "clawscarf", "telemetry-id"),
      "utf8",
    )
  ).trim();
  assert.ok(f.events.length >= 2);
  assert.ok(f.events.every((event) => event.distinct_id === id));
});

for (const response of ["error", "hang"] as const) {
  await test(`PostHog ${response} does not retry or prevent completion`, async (t) => {
    const f = await fixture(t, response);
    const telemetry = new CliTelemetry(f.environment, f.destination);
    const started = performance.now();
    await telemetry.start(command(telemetry, "start"));
    await telemetry.finish(0);
    assert.equal(f.requests.length, 2);
    assert.ok(performance.now() - started < 2000);
  });
}

await test("ready setup emits one installation milestone independently of repeated CLI commands", async (t) => {
  const f = await fixture(t);
  const identity = await prepareProductTelemetry(
    f.root,
    f.environment,
    f.destination,
  );
  assert.ok(identity);
  await writeFile(
    join(f.root, "installation.json"),
    JSON.stringify({ stateDirectory: "." }),
  );
  for (const [name, ready, code] of [
    ["configure", false, 0],
    ["configure", true, 1],
    ["configure", true, 0],
    ["status", true, 0],
  ] as const) {
    const telemetry = new CliTelemetry(f.environment, f.destination);
    const cmd = command(telemetry, name).action(() => {
      telemetry.configurationMode("new");
      telemetry.result({ ready });
    });
    await cmd.parent?.parseAsync([name, "--directory", f.root], {
      from: "user",
    });
    await telemetry.finish(code);
  }
  const milestones = f.events.filter(
    (event) => event.event === "installation_setup_completed",
  );
  assert.equal(milestones.length, 1);
  assert.ok(milestones[0]);
  assert.equal(
    milestones[0].distinct_id,
    `installation:${identity.installationId}`,
  );
  assert.equal(
    milestones[0].properties.installation_id,
    identity.installationId,
  );
  assert.equal(milestones[0].properties.source, "product");
  assert.equal(milestones[0].properties.$process_person_profile, false);
  assert.equal(milestones[0].properties.invocation_id, undefined);
  assert.doesNotMatch(JSON.stringify(milestones), new RegExp(f.root));
});
