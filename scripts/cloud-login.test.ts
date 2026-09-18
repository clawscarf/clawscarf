import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorizeCloud, CloudAuthorizationRequired } from "./cloud/login.js";

await test("cloud authorization resumes the same private challenge, honors polling and expires cached tokens", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-login-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "login");
  let now = Date.now(),
    challenges = 0,
    polls = 0;
  let outcome = "authorization_pending";
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    let body: unknown;
    let status = 200;
    if (url.pathname === "/api/identity")
      body = { issuer: "https://identity.example", clientId: "cli" };
    else if (url.pathname === "/.well-known/openid-configuration")
      body = {
        issuer: "https://identity.example",
        token_endpoint: "https://identity.example/token",
        device_authorization_endpoint: "https://identity.example/device",
      };
    else if (url.pathname === "/device") {
      challenges++;
      body = {
        device_code: "private-code",
        user_code: "ABCD-EFGH",
        expires_in: 600,
        interval: 5,
        verification_uri: "https://identity.example/device",
      };
    } else if (url.pathname === "/token") {
      polls++;
      status = outcome === "success" ? 200 : 400;
      body =
        outcome === "success"
          ? {
              access_token: "private-token",
              token_type: "Bearer",
              expires_in: 30,
            }
          : { error: outcome };
    } else throw Error(`Unexpected request ${url.pathname}`);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  const attempt = () =>
    authorizeCloud("https://cloud.example", file, { wait: false });
  await assert.rejects(attempt, (error: unknown) => {
    assert.ok(error instanceof CloudAuthorizationRequired);
    assert.equal(
      error.action.url,
      "https://cloud.example/setup?code=ABCD-EFGH",
    );
    assert.equal(error.action.retryAfterSeconds, 5);
    assert.ok(!JSON.stringify(error.action).includes("private"));
    return true;
  });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await assert.rejects(attempt, CloudAuthorizationRequired);
  assert.equal(challenges, 1);
  assert.equal(polls, 1);
  now += 5000;
  outcome = "slow_down";
  await assert.rejects(attempt, (error: unknown) => {
    assert.ok(error instanceof CloudAuthorizationRequired);
    assert.equal(error.action.retryAfterSeconds, 10);
    return true;
  });
  now += 10000;
  outcome = "success";
  assert.equal(await attempt(), "private-token");
  assert.equal(await attempt(), "private-token");
  assert.equal(polls, 3);
  assert.equal(challenges, 1);
  await assert.rejects(
    () => authorizeCloud("https://other.example", file, { wait: false }),
    { code: "invalid_configuration" },
  );
  now += 31000;
  outcome = "access_denied";
  await assert.rejects(attempt, { code: "invalid_configuration" });
  assert.equal(challenges, 2);
  await assert.rejects(readFile(file), { code: "ENOENT" });
  outcome = "authorization_pending";
  await assert.rejects(attempt, CloudAuthorizationRequired);
  now += 601000;
  await assert.rejects(attempt, CloudAuthorizationRequired);
  assert.equal(challenges, 4);
});
