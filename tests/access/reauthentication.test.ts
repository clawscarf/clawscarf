import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { createAccessHttp } from "../../services/access/runtime/http.js";
import { DeploymentOidcProvider } from "../../services/access/providers/oidc.js";
import { safeReturn } from "../../services/access/service/session.js";
import { AccessError } from "../../services/access/types/errors.js";
import { oidcFixture } from "./oidc.js";

await test("sign-out requires fresh OIDC authentication until a successful callback", async (t) => {
  const issuer = await oidcFixture();
  t.after(() => issuer.close());
  const origin = "https://clawscarf.example";
  const provider = new DeploymentOidcProvider({
    issuer: issuer.origin,
    clientId: issuer.clientId,
    clientSecret: issuer.clientSecret,
    redirectUri: origin + "/_clawscarf/callback",
  });
  let callbackError: AccessError | null = new AccessError(
    "invalid_authorization",
    "Expired",
  );
  const app = await createAccessHttp(
    {
      validateReturn: safeReturn,
      async startLogin(_returnTo, _setup, reauthenticate) {
        return {
          cookie: "pending",
          url: await provider.authorization({
            state: "state",
            nonce: "nonce",
            codeChallenge: "challenge",
            ...(reauthenticate ? { reauthenticate: true } : {}),
          }),
        };
      },
      completeLogin: () =>
        callbackError
          ? Promise.reject(callbackError)
          : Promise.resolve({ session: "new", returnTo: "/" }),
      authenticate: () => Promise.reject(new Error("unused")),
      localLogin: () => Promise.reject(new Error("unused")),
      csrf() {},
      logout: () => {
        return Promise.resolve(origin + "/_clawscarf/signed-out");
      },
    },
    origin,
  );
  t.after(() => app.close());
  // Ordinary first entry keeps provider SSO available.
  const first = await app.inject({ url: "/_clawscarf/login" });
  assert.equal(
    new URL(String(first.headers.location)).searchParams.get("prompt"),
    null,
  );
  const cookies = { clawscarf_reauthenticate: "1", clawscarf_login: "pending" };
  const fresh = await app.inject({ url: "/_clawscarf/login", cookies });
  assert.equal(
    new URL(String(fresh.headers.location)).searchParams.get("prompt"),
    "login",
  );
  const failed = await app.inject({
    url: "/_clawscarf/callback?state=state&code=code",
    cookies,
  });
  assert.equal(failed.statusCode, 400);
  assert.ok(!failed.cookies.some((c) => c.name === "clawscarf_reauthenticate"));
  for (const code of ["forbidden", "email_unverified"] as const) {
    callbackError = new AccessError(code, "Cannot admit this identity");
    const denied = await app.inject({
      url: "/_clawscarf/callback?state=state&code=code",
      cookies: { clawscarf_login: "pending" },
    });
    assert.equal(
      denied.cookies.find((c) => c.name === "clawscarf_reauthenticate")?.value,
      "1",
    );
  }
  callbackError = null;
  const completed = await app.inject({
    url: "/_clawscarf/callback?state=state&code=code",
    cookies,
  });
  assert.equal(completed.statusCode, 302);
  assert.equal(
    completed.cookies.find((c) => c.name === "clawscarf_reauthenticate")
      ?.maxAge,
    0,
  );
});

await test("OIDC recovers from discovery and token outages with a fresh sign-in", async (t) => {
  const issuer = await oidcFixture();
  t.after(() => issuer.close());
  const provider = new DeploymentOidcProvider({
    issuer: issuer.origin,
    clientId: issuer.clientId,
    clientSecret: issuer.clientSecret,
    redirectUri: "http://127.0.0.1:18800/_clawscarf/callback",
  });
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const request = {
    state,
    nonce,
    codeChallenge: createHash("sha256")
      .update(codeVerifier)
      .digest("base64url"),
  };
  issuer.setUnavailable(true);
  await assert.rejects(provider.authorization(request), {
    code: "dependency_unavailable",
  });
  issuer.setUnavailable(false);
  const begin = async () => {
    const response = await fetch(await provider.authorization(request), {
      redirect: "manual",
    });
    const callbackUrl = response.headers.get("location");
    assert.ok(callbackUrl);
    return { callbackUrl, state, nonce, codeVerifier };
  };
  const first = await begin();
  issuer.setUnavailable(true);
  await assert.rejects(provider.exchange(first), {
    code: "invalid_authorization",
  });
  issuer.setUnavailable(false);
  const fresh = await begin();
  assert.equal((await provider.exchange(fresh)).identity.subject, "alice");
  await assert.rejects(provider.exchange(fresh), {
    code: "invalid_authorization",
  });
});
