import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

const sessionToken = "private_session_fixture";
const runtimeToken = "private_runtime_fixture";
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-credential-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sessionFile = join(directory, "session");
  await writeFile(sessionFile, sessionToken, { mode: 0o600 });
  const calls: {
    path: string;
    method: string;
    cookie: string | undefined;
    csrf: string | undefined;
  }[] = [];
  const behavior = { redirect: false, lost: false };
  const server = createServer((request, response) => {
    calls.push({
      path: request.url ?? "",
      method: request.method ?? "",
      cookie: request.headers.cookie,
      csrf:
        typeof request.headers["x-csrf-token"] === "string"
          ? request.headers["x-csrf-token"]
          : undefined,
    });
    if (behavior.redirect) {
      response.writeHead(302, { location: "/redirected" }).end();
      return;
    }
    if (request.url === "/_clawscarf/session") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ csrfToken: "csrf-fixture" }));
      return;
    }
    if (behavior.lost) {
      response.destroy();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        token: runtimeToken,
        credentialId: "fixture-id",
        generation: 2,
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const output = join(directory, "runtime-token");
  async function invoke(originInput = origin) {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "services/connections/credential-command.ts",
        "--origin",
        originInput,
        "--session-file",
        sessionFile,
        "rotate",
        "--output",
        output,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    child.stdout.setEncoding("utf8").on("data", (value: string) => {
      stdout += value;
    });
    child.stderr.setEncoding("utf8").on("data", (value: string) => {
      stderr += value;
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.ok(!stdout.includes(runtimeToken) && !stderr.includes(runtimeToken));
    assert.ok(!stdout.includes(sessionToken) && !stderr.includes(sessionToken));
    return { code, stdout, stderr };
  }
  return { directory, sessionFile, output, calls, behavior, invoke, origin };
}

await test("credential CLI uses authenticated REST once and writes the token only to a private file", async (t) => {
  const f = await fixture(t);
  const result = await f.invoke();
  assert.equal(result.code, 0, result.stderr);
  assert.equal(await readFile(f.output, "utf8"), `${runtimeToken}\n`);
  assert.equal((await stat(f.output)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(result.stdout), {
    credentialId: "fixture-id",
    generation: 2,
  });
  assert.deepEqual(
    f.calls.map((call) => [call.method, call.path]),
    [
      ["GET", "/_clawscarf/session"],
      ["POST", "/_clawscarf/connections/v1/connection-credentials"],
    ],
  );
  assert.ok(
    f.calls.every(
      (call) => call.cookie === `clawscarf_session=${sessionToken}`,
    ),
  );
  assert.equal(f.calls[1]?.csrf, "csrf-fixture");
  assert.equal((await f.invoke()).code, 1);
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
});

await test("unsafe origin and public session files fail before sending a credential", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.invoke(`${f.origin}/other`)).code, 1);
  await chmod(f.sessionFile, 0o644);
  assert.equal((await f.invoke()).code, 1);
  assert.equal(f.calls.length, 0);
});

await test("credential CLI follows no redirect and never replays a lost rotation response", async (t) => {
  const f = await fixture(t);
  f.behavior.redirect = true;
  assert.equal((await f.invoke()).code, 1);
  assert.deepEqual(
    f.calls.map((call) => call.path),
    ["/_clawscarf/session"],
  );
  f.behavior.redirect = false;
  f.behavior.lost = true;
  const failed = await f.invoke();
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /interrupted request may already have revoked/);
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
  await assert.rejects(stat(f.output), { code: "ENOENT" });
});
