import assert from "node:assert/strict";
import { test } from "node:test";
import { safeReturn } from "../../services/access/service/session.js";
import { createAccessHttp } from "../../services/access/runtime/http.js";
import { AccessError } from "../../services/access/types/errors.js";

const origin = "https://clawscarf.example";
const privateDetail = '<script>alert("provider-private-detail")</script>';
function failingService(error: Error) {
  let calls = 0;
  const fail = () => {
    calls++;
    return Promise.reject(error);
  };
  return {
    service: {
      validateReturn: safeReturn,
      startLogin: fail,
      completeLogin: fail,
      authenticate: fail,
      csrf() {},
      logout: fail,
    },
    calls: () => calls,
  };
}

await test("unadmitted browser callback shows actionable safe HTML without replay or a session", async () => {
  const fixture = failingService(new AccessError("forbidden", privateDetail));
  const app = await createAccessHttp(fixture.service, origin);
  try {
    const response = await app.inject({
      url: `/_clawscarf/callback?state=one-use-state&error=access_denied&error_description=${encodeURIComponent(privateDetail)}`,
      headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      cookies: { clawscarf_login: "private-cookie" },
    });
    assert.equal(response.statusCode, 403);
    assert.match(response.headers["content-type"] ?? "", /^text\/html/);
    assert.match(response.body, /<h1>Access unavailable<\/h1>/);
    assert.match(response.body, /Ask your administrator for access/);
    assert.match(response.body, /href="\/_clawscarf\/login"/);
    assert.doesNotMatch(
      response.body,
      /script|provider-private|one-use-state|private-cookie/,
    );
    assert.equal(response.headers.location, undefined);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    assert.match(
      response.headers["content-security-policy"] ?? "",
      /default-src 'none'/,
    );
    assert.match(
      response.headers["content-security-policy"] ?? "",
      /frame-ancestors 'none'; base-uri 'none'/,
    );
    assert.ok(response.headers["x-request-id"]);
    const loginCookie = response.cookies.find(
      (cookie) => cookie.name === "clawscarf_login",
    );
    assert.equal(loginCookie?.value, "");
    assert.equal(loginCookie?.maxAge, 0);
    assert.equal(loginCookie?.httpOnly, true);
    assert.equal(loginCookie?.secure, true);
    assert.equal(
      response.cookies.some((cookie) => cookie.name === "clawscarf_session"),
      false,
    );
    assert.equal(fixture.calls(), 1);
  } finally {
    await app.close();
  }
});

await test("API login failures keep Problem Details and browser-only routes do not change API errors", async () => {
  const fixture = failingService(
    new AccessError("invalid_authorization", "Sign-in expired."),
  );
  const app = await createAccessHttp(fixture.service, origin);
  try {
    for (const accept of [
      undefined,
      "application/json",
      "application/problem+json",
      "*/*",
    ]) {
      const response = await app.inject({
        url: "/_clawscarf/callback?state=expired",
        headers: accept ? { accept } : {},
      });
      assert.equal(response.statusCode, 400);
      assert.match(
        response.headers["content-type"] ?? "",
        /^application\/problem\+json/,
      );
      assert.deepEqual(response.json(), {
        type: "about:blank",
        title: "invalid_authorization",
        status: 400,
        code: "invalid_authorization",
        detail: "Sign-in expired.",
        requestId: response.headers["x-request-id"],
      });
      assert.equal(
        response.cookies.find((cookie) => cookie.name === "clawscarf_login")
          ?.maxAge,
        0,
      );
    }
    const session = await app.inject({
      url: "/_clawscarf/session",
      headers: { accept: "text/html" },
    });
    assert.match(
      session.headers["content-type"] ?? "",
      /^application\/problem\+json/,
    );
  } finally {
    await app.close();
  }
});

await test("login failures offer a fresh sign-in without exposing error details", async () => {
  for (const scenario of [
    {
      route: "/_clawscarf/login",
      error: new Error(privateDetail),
      status: 503,
      copy: "Sign-in is temporarily unavailable.",
      href: "/_clawscarf/login",
    },
    {
      route: "/_clawscarf/callback?state=expired",
      error: new AccessError("invalid_authorization", privateDetail),
      status: 400,
      copy: "Start a new sign-in",
      href: "/_clawscarf/login",
    },
    {
      route: "/_clawscarf/callback?state=unverified",
      error: new AccessError("email_unverified", privateDetail),
      status: 403,
      copy: "Verify your email address",
      href: "/_clawscarf/login",
    },
  ]) {
    const fixture = failingService(scenario.error);
    const app = await createAccessHttp(fixture.service, origin);
    try {
      const response = await app.inject({
        url: scenario.route,
        headers: {
          accept: "text/html",
          origin,
          "content-type": "application/x-www-form-urlencoded",
        },
      });
      assert.equal(response.statusCode, scenario.status);
      assert.ok(response.body.includes(scenario.copy));
      assert.ok(response.body.includes(`href="${scenario.href}"`));
      assert.doesNotMatch(
        response.body,
        /provider-private|private-code|<script|<form/,
      );
      assert.equal(fixture.calls(), 1);
      assert.equal(response.headers.location, undefined);
    } finally {
      await app.close();
    }
  }
});

await test("callback validation fails safely before authentication", async () => {
  const fixture = failingService(new Error("Must not be reached"));
  const app = await createAccessHttp(fixture.service, origin);
  try {
    const invalid = await app.inject({
      url: "/_clawscarf/callback?error=access_denied",
      headers: { accept: "text/html" },
    });
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.body, /This sign-in request is invalid/);
    assert.equal(
      invalid.cookies.find((cookie) => cookie.name === "clawscarf_login")
        ?.maxAge,
      0,
    );
    assert.equal(fixture.calls(), 0);
  } finally {
    await app.close();
  }
});
