import assert from "node:assert/strict";
import { test } from "node:test";
import { Writable } from "node:stream";
import { safeReturn } from "../../services/access/service/session.js";
import { createAccessHttp } from "../../services/access/runtime/http.js";
import { failureDiagnostic } from "../../services/access/runtime/failures.js";
import { NativeFailure } from "../../services/access/types/native-errors.js";
import { AccessError } from "../../services/access/types/errors.js";

const origin = "https://clawscarf.example";
const service = {
  validateReturn: safeReturn,
  startLogin: () =>
    Promise.reject(
      new TypeError(
        "secret-vendor-body\n    at services/access/private-vendor-token.ts:1:2",
      ),
    ),
  completeLogin: () => Promise.reject(new Error("unused")),
  localLogin: () =>
    Promise.reject(new Error("must not authenticate invalid input")),
  authenticate: () => Promise.reject(new NativeFailure("request_rejected")),
  csrf() {},
  logout: () => Promise.reject(new Error("unused")),
};

await test("unfinished administrator setup returns terminal guidance without an ordinary sign-in link", async () => {
  const fail = () =>
    Promise.reject(
      new AccessError("administrator_setup_required", "private details"),
    );
  const app = await createAccessHttp(
    { ...service, startLogin: fail, completeLogin: fail },
    origin,
  );
  try {
    for (const url of [
      "/_clawscarf/login",
      "/_clawscarf/callback?state=expired&code=expired",
    ]) {
      const response = await app.inject({
        url,
        headers: { accept: "text/html" },
      });
      assert.equal(response.statusCode, 409);
      assert.match(response.body, /Return to the installer/);
      assert.doesNotMatch(response.body, /href=|private details/);
    }
  } finally {
    await app.close();
  }
});

await test("malformed JSON, empty JSON, unsupported content types and oversize input retain client status", async () => {
  const app = await createAccessHttp(service, origin);
  try {
    for (const scenario of [
      { type: "application/json", body: "{", status: 400 },
      { type: "application/json", body: "", status: 400 },
      { type: "application/json", body: "{}", status: 400 },
      {
        type: "application/xml",
        body: "<token>private-value</token>",
        status: 415,
      },
      {
        type: "application/json",
        body: JSON.stringify({ token: "x".repeat(256 * 1024) }),
        status: 413,
      },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/_clawscarf/local",
        payload: scenario.body,
        headers: { origin, "content-type": scenario.type },
      });
      assert.equal(response.statusCode, scenario.status);
      const body: unknown = response.json();
      assert.ok(typeof body === "object" && body !== null && "code" in body);
      assert.equal(body.code, "invalid_request");
      assert.doesNotMatch(response.body, /private-value|must not authenticate/);
    }
  } finally {
    await app.close();
  }
});

await test("unexpected failures emit allowlisted diagnostics with the response request ID", async () => {
  let output = "";
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const app = await createAccessHttp(
    service,
    origin,
    undefined,
    undefined,
    [],
    { stream, level: "error" },
  );
  try {
    const response = await app.inject({
      url: "/_clawscarf/login?returnTo=%2F",
      headers: {
        cookie: "private-cookie",
        authorization: "Bearer private-token",
        "x-request-id": "attacker-request-id",
      },
    });
    assert.equal(response.statusCode, 503);
    const lines = output.trim().split("\n");
    assert.equal(lines.length, 1);
    const event: unknown = JSON.parse(lines[0] ?? "");
    assert.ok(
      typeof event === "object" &&
        event !== null &&
        "reqId" in event &&
        "operation" in event &&
        "kind" in event,
    );
    assert.equal(event.reqId, response.headers["x-request-id"]);
    assert.equal(event.operation, "startLogin");
    assert.equal(event.kind, "TypeError");
    assert.doesNotMatch(
      output,
      /secret-vendor-body|private-vendor-token|private-cookie|private-token|attacker-request-id|returnTo/,
    );
    const rejected = await app.inject({ url: "/_clawscarf/session" });
    assert.equal(rejected.statusCode, 409);
    assert.match(rejected.body, /request_rejected/);
    assert.doesNotMatch(rejected.body, /outcome_unknown/);
  } finally {
    await app.close();
  }
});

await test("diagnostic source locations exclude the entire multiline message and malformed stack headers", () => {
  const error = new Error(
    "vendor failure\n    at services/access/private-token.ts:1:2",
  );
  assert.equal("location" in failureDiagnostic(error), false);
  const header = `${error.name}: ${error.message}\n`;
  error.stack = `${header}    at handle (/repo/services/access/service/session.ts:20:3)`;
  assert.deepEqual(failureDiagnostic(error), {
    kind: "Error",
    location: "services/access/service/session.ts:20:3",
  });
  error.stack =
    "mismatched header\n    at services/access/private-token.ts:1:2";
  assert.equal("location" in failureDiagnostic(error), false);
});
