import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { sessionRequest } from "./session.js";

await test("management clients share CSRF, reject redirects and validate private credentials before sending", async (t) => {
  const directory = await mkdtemp("/tmp/cs-session-");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sessionFile = join(directory, "session");
  const token = "a".repeat(43);
  await writeFile(sessionFile, token, { mode: 0o600 });
  const app = Fastify();
  t.after(() => app.close());
  let calls = 0,
    redirects = 0,
    redirect = false;
  app.get("/_clawscarf/session", (request, reply) => {
    calls++;
    assert.equal(request.headers.cookie, `clawscarf_session=${token}`);
    assert.equal(request.headers.origin, origin);
    return redirect ? reply.redirect("/unexpected") : { csrfToken: "csrf" };
  });
  app.get("/unexpected", () => {
    redirects++;
    return {};
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const result = await sessionRequest({ origin, sessionFile });
  assert.equal(result.headers["x-csrf-token"], "csrf");
  assert.equal(result.redirect, "error");
  assert.ok(result.signal instanceof AbortSignal);
  redirect = true;
  await assert.rejects(sessionRequest({ origin, sessionFile }));
  assert.equal(calls, 2);
  assert.equal(redirects, 0);
  await writeFile(sessionFile, "injected; other=cookie");
  await assert.rejects(sessionRequest({ origin, sessionFile }), {
    code: "invalid_configuration",
  });
  await assert.rejects(
    sessionRequest({ origin: "http://untrusted.example", sessionFile }),
  );
  assert.equal(calls, 2);
});
