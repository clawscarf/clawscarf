import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { z } from "zod";
import { PostgresAccessStore } from "../../services/access/repo/postgres.js";
import { SessionService, hash } from "../../services/access/service/session.js";
import { EnrollmentService } from "../../services/access/service/enrollment.js";
import type { NativeAuthority } from "../../services/access/types/native.js";
import { NativeFailure } from "../../services/access/types/native-errors.js";
import { createAccessHttp } from "../../services/access/runtime/http.js";
const url = process.env.CLAWSCARF_TEST_DATABASE_URL;
await test(
  "real Postgres local login, CSRF, revocation, admission revision and restart identity",
  { skip: !url },
  async () => {
    const pool = new pg.Pool({ connectionString: url });
    const migration = await readFile(
      new URL(
        "../../services/access/migrations/001_access.sql",
        import.meta.url,
      ),
      "utf8",
    );
    try {
      await pool.query(migration.split("-- Down Migration")[0] ?? "");
      const key = randomBytes(32),
        initial = {
          issuer: "urn:clawscarf:local",
          subject: "administrator",
          email: "administrator@localhost",
          name: "Local admin",
        };
      const repo = new PostgresAccessStore(pool, key, initial),
        service = new SessionService(repo, null, "http://127.0.0.1:18800");
      const id = await repo.initialize();
      assert.deepEqual(await repo.initialize(), id);
      const resumed = new PostgresAccessStore(pool, key, initial);
      assert.deepEqual(await resumed.initialize(), id);
      await assert.rejects(
        new PostgresAccessStore(pool, key, {
          ...initial,
          subject: "different",
        }).initialize(),
        /Configured initial identity differs/,
      );
      const code = randomUUID();
      await repo.createLocalToken(hash(code));
      const outcomes = await Promise.allSettled([
        service.localLogin(code),
        service.localLogin(code),
      ]);
      assert.equal(
        outcomes.filter((value) => value.status === "fulfilled").length,
        1,
      );
      const success = outcomes.find((value) => value.status === "fulfilled");
      assert.ok(success?.status === "fulfilled");
      const actor = await service.authenticate(success.value.session);
      assert.equal(actor.user.id, id.administrator.id);
      assert.throws(() =>
        service.csrf(actor, "http://evil.example", actor.csrfToken),
      );
      let nativeWrites = 0;
      let deny = false;
      const native: NativeAuthority = {
        observeTeam: () =>
          deny
            ? Promise.reject(new NativeFailure("access_denied"))
            : Promise.resolve("ready"),
        verifyAdministrator: () =>
          deny
            ? Promise.reject(new NativeFailure("access_denied"))
            : Promise.resolve({ agentIds: ["main"] }),
        prepareTeam: () => Promise.resolve(),
        enroll: async (_actor, credential, person, target) => {
          assert.equal(
            (await service.authenticate(credential)).user.id,
            actor.user.id,
          );
          assert.equal(
            (await service.authenticate(target)).user.id,
            person.identity.slice("clawscarf:".length),
          );
          nativeWrites++;
        },
        revoke: () => Promise.resolve(),
      };
      const enrollment = new EnrollmentService(
        repo,
        native,
        "http://127.0.0.1:18800",
        "https://company.example",
      );
      const app = await createAccessHttp(
        service,
        "http://127.0.0.1:18800",
        undefined,
        enrollment,
      );
      try {
        const form = await app.inject({ url: "/_clawscarf/local-sign-in" });
        assert.equal(form.headers["referrer-policy"], "same-origin");
        assert.match(form.body, /Sign-in code/);
        const me = await app.inject({
          url: "/_clawscarf/session",
          headers: { cookie: `clawscarf_session=${success.value.session}` },
        });
        assert.equal(me.statusCode, 200);
        const headers = {
          cookie: `clawscarf_session=${success.value.session}`,
          origin: "http://127.0.0.1:18800",
          "x-csrf-token": actor.csrfToken,
        };
        assert.equal(
          (await app.inject({ url: "/_clawscarf/session?unknown=1", headers }))
            .statusCode,
          400,
        );
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/_clawscarf/team",
              headers,
              payload: {},
            })
          ).statusCode,
          400,
        );
        const observed = await app.inject({
          url: "/_clawscarf/people",
          headers,
        });
        assert.equal(observed.statusCode, 200, observed.body);
        assert.equal(
          observed.json<{ enrollment: string }>().enrollment,
          "ready",
        );
        assert.equal(nativeWrites, 0);
        deny = true;
        assert.equal(
          (await app.inject({ url: "/_clawscarf/people", headers })).statusCode,
          403,
        );
        const personInput = {
          subject: "bob",
          email: "bob@example.com",
          name: "Bob",
        };
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/_clawscarf/people",
              headers,
              payload: personInput,
            })
          ).statusCode,
          403,
        );
        assert.equal(nativeWrites, 0);
        deny = false;
        const added = await app.inject({
          method: "POST",
          url: "/_clawscarf/people",
          headers,
          payload: personInput,
        });
        assert.equal(added.statusCode, 200, added.body);
        assert.equal(nativeWrites, 1);
        const bob = await repo.admitIdentity({
          ...personInput,
          issuer: "https://company.example",
          emailVerified: true,
        });
        const removed = await app.inject({
          method: "DELETE",
          url: `/_clawscarf/people/${bob.id}`,
          headers,
        });
        assert.equal(removed.statusCode, 200, removed.body);
        await assert.rejects(
          repo.admitIdentity({
            ...personInput,
            issuer: "https://company.example",
            emailVerified: true,
          }),
          { code: "forbidden" },
        );
        await repo.withEnrollmentLock(async () => {
          const reads = await Promise.all([
            enrollment.list(actor),
            enrollment.list(actor),
          ]);
          assert.equal(reads.length, 2);
        });
        const localRedirect = await service.startLogin(
          "/_clawscarf/connections/return/abc",
        );
        assert.equal(
          localRedirect.url,
          "/_clawscarf/local-sign-in?returnTo=%2F_clawscarf%2Fconnections%2Freturn%2Fabc",
        );
        const bad = await app.inject({
          method: "POST",
          url: "/_clawscarf/logout",
          headers: {
            cookie: `clawscarf_session=${success.value.session}`,
            origin: "http://evil.example",
            "x-csrf-token": actor.csrfToken,
          },
        });
        assert.equal(bad.statusCode, 403);
        const logout = await app.inject({
          method: "POST",
          url: "/_clawscarf/logout",
          headers: {
            cookie: `clawscarf_session=${success.value.session}`,
            origin: "http://127.0.0.1:18800",
            "x-csrf-token": actor.csrfToken,
          },
        });
        assert.equal(logout.statusCode, 200);
        await assert.rejects(service.authenticate(success.value.session), {
          code: "unauthenticated",
        });
      } finally {
        await app.close();
      }
      await repo.createSession(
        id.administrator.id,
        hash("stale"),
        "csrf",
        null,
      );
      await pool.query(
        "UPDATE clawscarf_access.users SET revision=revision+1 WHERE id=$1",
        [id.administrator.id],
      );
      assert.equal(await repo.authenticateSession(hash("stale")), null);
      await assert.rejects(
        repo.admitIdentity({
          issuer: "https://id.example",
          subject: "unknown",
          email: "x@example.com",
          emailVerified: true,
          name: "X",
        }),
        { code: "forbidden" },
      );
    } finally {
      await pool.query("DROP SCHEMA IF EXISTS clawscarf_access CASCADE");
      await pool.end();
    }
  },
);

await test(
  "signed OIDC requires explicit enrollment, correct nonce and one-use callback",
  { skip: !url },
  async () => {
    const { oidcFixture } = await import("./oidc.js");
    const { DeploymentOidcProvider } =
      await import("../../services/access/providers/oidc.js");
    const oidc = await oidcFixture(true),
      pool = new pg.Pool({ connectionString: url });
    try {
      const migration = await readFile(
        new URL(
          "../../services/access/migrations/001_access.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await pool.query(migration.split("-- Down Migration")[0] ?? "");
      const repo = new PostgresAccessStore(pool, randomBytes(32), {
        issuer: oidc.origin,
        subject: "alice",
        email: "alice@example.test",
        name: "Alice",
      });
      await repo.initialize();
      const provider = new DeploymentOidcProvider({
        issuer: oidc.origin,
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        redirectUri: "http://127.0.0.1:18800/_clawscarf/callback",
      });
      const service = new SessionService(
        repo,
        provider,
        "http://127.0.0.1:18800",
      );
      async function authorize() {
        const login = await service.startLogin("/settings/models");
        const response = await fetch(login.url, { redirect: "manual" });
        await response.body?.cancel();
        const callback = response.headers.get("location");
        assert.ok(callback);
        return {
          login,
          callback,
          state: new URL(callback).searchParams.get("state") ?? "",
        };
      }
      const first = await authorize();
      const result = await service.completeLogin(
        first.login.cookie,
        first.state,
        first.callback,
      );
      assert.equal(result.returnTo, "/settings/models");
      const actor = await service.authenticate(result.session);
      assert.equal(actor.user.email, "alice@example.test");
      await assert.rejects(
        service.completeLogin(first.login.cookie, first.state, first.callback),
        { code: "invalid_authorization" },
      );
      let delegated = "";
      await service.withActingSession(actor.hash, async (credential) => {
        delegated = credential;
        assert.equal(
          (await service.authenticate(credential)).user.id,
          actor.user.id,
        );
      });
      await assert.rejects(service.authenticate(delegated), {
        code: "unauthenticated",
      });
      await repo.withEnrollmentLock(async (locked) => {
        await assert.rejects(
          repo.withEnrollmentLock(() => Promise.resolve(undefined)),
          { code: "rate_limited" },
        );
        const lockedSessions = new SessionService(
          locked,
          null,
          "http://127.0.0.1:18800",
        );
        await lockedSessions.withActingSession(
          actor.hash,
          async (credential) => {
            assert.ok(
              await repo.authenticateSession(hash(credential)),
              "Delegated credential must be visible to concurrent ingress checks.",
            );
          },
        );
      });
      const pending = await repo.prepareEnrollment({
        issuer: oidc.origin,
        subject: "bob",
        email: "bob@example.test",
        emailVerified: true,
        name: "Bob",
      });
      await assert.rejects(
        repo.createSession(pending.id, hash("not-admitted"), "csrf", null),
        { code: "forbidden" },
      );
      await repo.createSession(
        actor.user.id,
        hash("enrollment-parent"),
        "csrf",
        null,
      );
      await service.withEnrollmentSession(
        hash("enrollment-parent"),
        pending.id,
        async (credential) => {
          assert.equal(
            (await service.authenticate(credential)).user.id,
            pending.id,
          );
          await repo.revokeSession(hash("enrollment-parent"));
          await assert.rejects(service.authenticate(credential), {
            code: "unauthenticated",
          });
        },
      );
      const logout = await service.logout(actor);
      assert.ok(logout.startsWith(oidc.origin + "/logout"));
      assert.ok(logout.includes("id_token_hint="));
      oidc.setUser("not-enrolled");
      const unknown = await authorize();
      await assert.rejects(
        service.completeLogin(
          unknown.login.cookie,
          unknown.state,
          unknown.callback,
        ),
        { code: "forbidden" },
      );
      oidc.setUser("alice");
      oidc.setInvalidNonce(true);
      const invalid = await authorize();
      await assert.rejects(
        service.completeLogin(
          invalid.login.cookie,
          invalid.state,
          invalid.callback,
        ),
        { code: "invalid_authorization" },
      );
    } finally {
      await pool.query("DROP SCHEMA IF EXISTS clawscarf_access CASCADE");
      await pool.end();
      await oidc.close();
    }
  },
);

await test(
  "signed OIDC HTTP enrollment stays closed until native confirmation and old sessions cannot revive",
  { skip: !url },
  async () => {
    const { oidcFixture } = await import("./oidc.js");
    const { beginOidcBrowserLogin } = await import("./oidc-http.js");
    const { DeploymentOidcProvider } =
      await import("../../services/access/providers/oidc.js");
    const oidc = await oidcFixture(true);
    const pool = new pg.Pool({ connectionString: url });
    const origin = "http://127.0.0.1:18800";
    let app: Awaited<ReturnType<typeof createAccessHttp>> | undefined;
    try {
      const migration = await readFile(
        new URL(
          "../../services/access/migrations/001_access.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await pool.query(migration.split("-- Down Migration")[0] ?? "");
      const repo = new PostgresAccessStore(pool, randomBytes(32), {
        issuer: oidc.origin,
        subject: "alice",
        email: "alice@example.test",
        name: "Alice",
      });
      const identity = await repo.initialize();
      const service = new SessionService(
        repo,
        new DeploymentOidcProvider({
          issuer: oidc.origin,
          clientId: oidc.clientId,
          clientSecret: oidc.clientSecret,
          redirectUri: origin + "/_clawscarf/callback",
        }),
        origin,
      );
      let nativeCompletion = false;
      let enrollmentCalls = 0;
      // This case tests HTTP/session/admission boundaries. Native permission
      // enforcement and promotion are exercised by native-live.test.ts.
      const native: NativeAuthority = {
        observeTeam: (actor) =>
          actor.identity === identity.administrator.identity
            ? Promise.resolve("ready")
            : Promise.reject(new NativeFailure("access_denied")),
        verifyAdministrator: (actor) => {
          if (actor.identity !== identity.administrator.identity)
            return Promise.reject(new NativeFailure("access_denied"));
          return Promise.resolve({ agentIds: ["main"] });
        },
        prepareTeam: () => Promise.resolve(),
        enroll: async (actor, credential, person, target) => {
          enrollmentCalls++;
          assert.equal(
            (await service.authenticate(credential)).user.identity,
            actor.identity,
          );
          assert.equal(
            (await service.authenticate(target)).user.identity,
            person.identity,
          );
          if (!nativeCompletion) throw new NativeFailure("outcome_unknown");
        },
        revoke: () => Promise.resolve(),
      };
      const team = new EnrollmentService(repo, native, origin, oidc.origin);
      app = await createAccessHttp(service, origin, undefined, team);
      const first = await beginOidcBrowserLogin(app, "/settings/models");
      assert.equal((await first.complete("another-browser")).statusCode, 400);
      const callback = await first.complete();
      assert.equal(callback.statusCode, 302);
      assert.equal(callback.headers.location, "/settings/models");
      assert.equal((await first.complete()).statusCode, 400);
      const adminCookie = callback.cookies.find(
        (cookie) => cookie.name === "clawscarf_session",
      );
      assert.ok(adminCookie?.value);
      assert.equal(adminCookie.httpOnly, true);
      const administrator = await service.authenticate(adminCookie.value);
      const headers = {
        cookie: "clawscarf_session=" + adminCookie.value,
        origin,
        "x-csrf-token": administrator.csrfToken,
      };
      const input = { subject: "bob", email: "bob@example.test", name: "Bob" };
      const enrollment = {
        method: "POST" as const,
        url: "/_clawscarf/people",
        headers,
        payload: input,
      };
      assert.equal(
        (
          await app.inject({
            ...enrollment,
            headers: { ...headers, origin: "http://evil.example" },
          })
        ).statusCode,
        403,
      );
      assert.equal(enrollmentCalls, 0);
      oidc.setUser("bob");
      assert.equal(
        (await (await beginOidcBrowserLogin(app, "/")).complete()).statusCode,
        403,
      );
      assert.equal((await app.inject(enrollment)).statusCode, 503);
      assert.equal(enrollmentCalls, 1);
      assert.equal(
        (await (await beginOidcBrowserLogin(app, "/")).complete()).statusCode,
        403,
      );
      assert.equal(
        enrollmentCalls,
        1,
        "Login never retries native enrollment.",
      );
      nativeCompletion = true;
      assert.equal((await app.inject(enrollment)).statusCode, 200);
      assert.equal(enrollmentCalls, 2);
      const memberResponse = await (
        await beginOidcBrowserLogin(app, "/_clawscarf/team/")
      ).complete();
      assert.equal(memberResponse.statusCode, 302);
      assert.equal(memberResponse.headers.location, "/_clawscarf/team/");
      const memberCookie = memberResponse.cookies.find(
        (cookie) => cookie.name === "clawscarf_session",
      );
      assert.ok(memberCookie?.value);
      const member = await service.authenticate(memberCookie.value);
      assert.notEqual(member.user.id, administrator.user.id);
      assert.equal(member.user.email, "bob@example.test");
      assert.equal(
        (
          await app.inject({
            url: "/_clawscarf/people",
            cookies: { clawscarf_session: memberCookie.value },
          })
        ).statusCode,
        403,
      );
      const pendingLogin = await beginOidcBrowserLogin(app, "/");
      assert.equal(
        (
          await app.inject({
            method: "DELETE",
            url: "/_clawscarf/people/" + member.user.id,
            headers,
          })
        ).statusCode,
        200,
      );
      assert.equal((await pendingLogin.complete()).statusCode, 403);
      assert.equal(
        (
          await app.inject({
            url: "/_clawscarf/session",
            cookies: { clawscarf_session: memberCookie.value },
          })
        ).statusCode,
        401,
      );
      assert.equal((await app.inject(enrollment)).statusCode, 200);
      assert.equal((await pendingLogin.complete()).statusCode, 400);
      assert.equal(
        (
          await app.inject({
            url: "/_clawscarf/session",
            cookies: { clawscarf_session: memberCookie.value },
          })
        ).statusCode,
        401,
      );
      const rejoined = await (await beginOidcBrowserLogin(app, "/")).complete();
      assert.equal(rejoined.statusCode, 302);
      const freshCookie = rejoined.cookies.find(
        (cookie) => cookie.name === "clawscarf_session",
      );
      assert.ok(freshCookie?.value);
      assert.equal(
        (await service.authenticate(freshCookie.value)).user.id,
        member.user.id,
      );
      const logout = await app.inject({
        method: "POST",
        url: "/_clawscarf/logout",
        headers,
      });
      assert.equal(logout.statusCode, 200);
      assert.equal(
        logout.cookies.find((cookie) => cookie.name === "clawscarf_session")
          ?.maxAge,
        0,
      );
      assert.equal(
        (await app.inject({ url: "/_clawscarf/session", headers })).statusCode,
        401,
      );
      assert.equal(
        (
          await app.inject({
            url: "/_clawscarf/session",
            cookies: { clawscarf_session: freshCookie.value },
          })
        ).statusCode,
        200,
      );
      const destination = z
        .object({ redirect: z.url() })
        .parse(logout.json<unknown>()).redirect;
      const providerLogout = await fetch(destination, { redirect: "manual" });
      await providerLogout.body?.cancel();
      assert.equal(providerLogout.status, 302);
      assert.equal(
        providerLogout.headers.get("location"),
        origin + "/_clawscarf/signed-out",
      );
      assert.equal(
        (await app.inject({ url: "/_clawscarf/signed-out" })).statusCode,
        200,
      );
    } finally {
      await app?.close();
      await pool.query("DROP SCHEMA IF EXISTS clawscarf_access CASCADE");
      await pool.end();
      await oidc.close();
    }
  },
);
