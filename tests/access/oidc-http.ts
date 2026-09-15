import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

/** Exercise registered login/callback handlers and the signed local IdP over HTTP. */
export async function beginOidcBrowserLogin(
  app: FastifyInstance,
  returnTo: string,
) {
  const start = await app.inject({
    url: `/_clawscarf/login?returnTo=${encodeURIComponent(returnTo)}`,
  });
  assert.equal(start.statusCode, 302);
  const cookie = start.cookies.find(
    (value) => value.name === "clawscarf_login",
  );
  assert.ok(cookie?.value);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Lax");
  const authorization = start.headers.location;
  assert.equal(typeof authorization, "string");
  assert.ok(authorization);
  const response = await fetch(authorization, { redirect: "manual" });
  await response.body?.cancel();
  assert.equal(response.status, 302);
  const location = response.headers.get("location");
  assert.ok(location);
  const callback = new URL(location);
  return {
    complete: (browserCookie = cookie.value) =>
      app.inject({
        url: callback.pathname + callback.search,
        cookies: { clawscarf_login: browserCookie },
      }),
  };
}
