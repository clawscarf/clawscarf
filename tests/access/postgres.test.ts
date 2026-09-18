import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { z } from "zod";
import { PostgresAccessStore } from "../../services/access/repo/postgres.js";
import { SessionService, hash } from "../../services/access/service/session.js";
import { EnrollmentService } from "../../services/access/service/enrollment.js";
import type { NativeAuthority } from "../../services/access/types/native.js";
import { NativeFailure } from "../../services/access/types/native-errors.js";
import { createAccessHttp } from "../../services/access/runtime/http.js";
const url = process.env.CLAWSCARF_TEST_DATABASE_URL;
async function migrate(pool: pg.Pool) {
  const directory = new URL(
    "../../services/access/migrations/",
    import.meta.url,
  );
  for (const file of (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(new URL(file, directory), "utf8");
    await pool.query(sql.split("-- Down Migration")[0] ?? "");
  }
}

await test(
  "real Postgres OIDC login, CSRF, revocation, admission revision and restart identity",
  { skip: !url },
  async () => {
    const pool = new pg.Pool({ connectionString: url });
    try {
      await migrate(pool);
      const key = randomBytes(32),
        initial = {
          issuer: "https://identity.example.test",
          subject: "administrator",
          email: "administrator@localhost",
          name: "Administrator",
        };
      const repo = new PostgresAccessStore(pool, key, initial),
        service = new SessionService(
          repo,
          {
            authorization: ({ state }) =>
              Promise.resolve(
                `https://identity.example.test/authorize?state=${state}`,
              ),
            exchange: () =>
              Promise.resolve({
                identity: { ...initial, emailVerified: true },
                logoutUrl: null,
              }),
          },
          "http://127.0.0.1:18800",
        );
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
      const login = await service.startLogin();
      const state = new URL(login.url).searchParams.get("state");
      assert.ok(state);
      const outcomes = await Promise.allSettled([
        service.completeLogin(
          login.cookie,
          state,
          "http://127.0.0.1:18800/_clawscarf/callback?code=fixture",
        ),
        service.completeLogin(
          login.cookie,
          state,
          "http://127.0.0.1:18800/_clawscarf/callback?code=fixture",
        ),
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
        people: async (actor, credential) => ({
          enrollment: await native.observeTeam(actor, credential),
          roles: [],
          people: [],
        }),
        setRole: () => Promise.resolve(),
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
        assert.equal(
          (await app.inject({ url: "/_clawscarf/local-sign-in" })).statusCode,
          404,
        );
        const complete = await app.inject({
          url: "/_clawscarf/setup-complete",
          cookies: { clawscarf_session: success.value.session },
        });
        assert.equal(complete.statusCode, 200);
        assert.match(complete.body, /Administrator ready/);
        assert.doesNotMatch(complete.body, /href="\/"/);
        assert.match(complete.body, /return to your terminal/);
        assert.equal(
          (await app.inject({ url: "/_clawscarf/setup-complete" })).statusCode,
          401,
        );
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
        const freshLogin = logout.cookies.find(
          (cookie) => cookie.name === "clawscarf_reauthenticate",
        );
        assert.equal(freshLogin?.value, "1");
        assert.equal(freshLogin?.httpOnly, true);
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
      await migrate(pool);
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
          provider,
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
      await migrate(pool);
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
        people: async (actor, credential) => ({
          enrollment: await native.observeTeam(actor, credential),
          roles: [],
          people: [],
        }),
        setRole: () => Promise.resolve(),
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
        await beginOidcBrowserLogin(app, "/")
      ).complete();
      assert.equal(memberResponse.statusCode, 302);
      assert.equal(memberResponse.headers.location, "/");
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

await test(
  "storage preparation needs neither OIDC secrets, TLS files nor native/browser services",
  { skip: !url },
  async () => {
    assert.ok(url);
    const { openAccessStorage } =
      await import("../../services/access/runtime/storage.js");
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-storage-"));
    const pool = new pg.Pool({ connectionString: url });
    let storage: Awaited<ReturnType<typeof openAccessStorage>> | undefined;
    try {
      await migrate(pool);
      const encryptionKeyFile = join(directory, "encryption-key");
      await writeFile(encryptionKeyFile, randomBytes(32), { mode: 0o600 });
      storage = await openAccessStorage({
        databaseUrl: url,
        encryptionKeyFile,
        identity: {
          mode: "oidc",
          issuer: "https://unreachable-idp.invalid",
          clientId: "not-yet-configured",
          clientSecretFile: join(directory, "does-not-exist"),
          administratorSubject: "owner",
          administratorEmail: "owner@example.test",
        },
      });
      assert.equal(storage.identity.administrator.email, "owner@example.test");
      assert.deepEqual(await storage.repository.initialize(), storage.identity);
    } finally {
      await storage?.close();
      await pool.query("DROP SCHEMA IF EXISTS clawscarf_access CASCADE");
      await pool.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

await test(
  "private administrator setup binds one verified OIDC identity and admits only after native proof",
  { skip: !url },
  async () => {
    const pool = new pg.Pool({ connectionString: url });
    const { oidcFixture } = await import("./oidc.js");
    const { DeploymentOidcProvider } =
      await import("../../services/access/providers/oidc.js");
    const oidc = await oidcFixture();
    try {
      await migrate(pool);
      const initial = {
        issuer: oidc.origin,
        subject: "urn:clawscarf:unclaimed",
        email: "",
        name: "Administrator",
        claimRequired: true,
      };
      const key = randomBytes(32),
        repo = new PostgresAccessStore(pool, key, initial);
      const identity = await repo.initialize();
      const alice = {
        issuer: oidc.origin,
        subject: "alice",
        email: "alice@example.test",
        name: "Alice",
        emailVerified: true,
      };
      await assert.rejects(repo.admitIdentity(alice), { code: "forbidden" });
      assert.equal((await repo.administratorSetup()).complete, false);
      await repo.beginAdministratorSetup(hash("expired"));
      await pool.query(
        "UPDATE clawscarf_access.server SET setup_expires_at=clock_timestamp()-interval '1 second'",
      );
      await assert.rejects(
        repo.bindAdministrator(hash("expired"), alice, hash("expired-session")),
        { code: "invalid_authorization" },
      );
      await repo.beginAdministratorSetup(hash("setup"));
      await assert.rejects(
        repo.bindAdministrator(
          hash("setup"),
          { ...alice, emailVerified: false },
          hash("unverified"),
        ),
        { code: "email_unverified" },
      );
      // The locked repository still needs a real transaction: a wrong issuer cannot poison the subject binding.
      await repo.withEnrollmentLock(async (locked) => {
        await assert.rejects(
          locked.bindAdministrator(
            hash("setup"),
            { ...alice, subject: "wrong", issuer: "https://wrong.example" },
            hash("wrong"),
          ),
          { code: "forbidden" },
        );
      });
      assert.equal(
        (
          await pool.query<{ setup_subject: string | null }>(
            "SELECT setup_subject FROM clawscarf_access.server",
          )
        ).rows[0]?.setup_subject,
        null,
      );
      const bound = await repo.bindAdministrator(
        hash("setup"),
        alice,
        hash("temporary"),
      );
      assert.equal(bound.id, identity.administrator.id);
      assert.ok(await repo.authenticateSession(hash("temporary")));
      await assert.rejects(
        repo.createSession(bound.id, hash("browser-too-soon"), "csrf", null),
        { code: "forbidden" },
      );
      await assert.rejects(
        repo.bindAdministrator(
          hash("setup"),
          { ...alice, subject: "mallory" },
          hash("other"),
        ),
        { code: "invalid_authorization" },
      );
      await repo.beginAdministratorSetup(hash("replacement"));
      assert.equal(await repo.authenticateSession(hash("temporary")), null);
      await assert.rejects(
        repo.bindAdministrator(hash("setup"), alice, hash("old-link")),
        { code: "invalid_authorization" },
      );
      await assert.rejects(
        repo.bindAdministrator(
          hash("replacement"),
          { ...alice, subject: "mallory" },
          hash("takeover"),
        ),
        { code: "invalid_authorization" },
      );

      const provider = new DeploymentOidcProvider({
        issuer: oidc.origin,
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        redirectUri: "http://127.0.0.1:18800/_clawscarf/callback",
      });
      let failNative = true;
      let credential = "";
      const native: NativeAuthority = {
        people: async (actor, credential) => ({
          enrollment: await native.observeTeam(actor, credential),
          roles: [],
          people: [],
        }),
        setRole: () => Promise.resolve(),
        observeTeam: () => Promise.resolve("ready"),
        verifyAdministrator: async (actor, value) => {
          credential = value;
          assert.equal(
            (await repo.authenticateSession(hash(value)))?.user.identity,
            actor.identity,
          );
          assert.equal(actor.identity, identity.administrator.identity);
          if (failNative) throw new NativeFailure("access_denied");
          return Promise.resolve({ agentIds: ["main"] });
        },
        prepareTeam: () => Promise.resolve(),
        enroll: () => Promise.resolve(),
        revoke: () => Promise.resolve(),
      };
      const service = new SessionService(
        repo,
        provider,
        "http://127.0.0.1:18800",
        undefined,
        native,
      );
      async function callback(setup?: string) {
        const login = await service.startLogin(
          setup ? "/_clawscarf/setup-complete" : "/",
          setup,
        );
        const response = await fetch(login.url, { redirect: "manual" });
        await response.body?.cancel();
        const target = response.headers.get("location");
        assert.ok(target);
        return service.completeLogin(
          login.cookie,
          new URL(target).searchParams.get("state") ?? "",
          target,
        );
      }
      await assert.rejects(callback(), {
        code: "administrator_setup_required",
      });
      const abandoned = await service.startLogin(
        "/_clawscarf/setup-complete",
        "replacement",
      );
      await pool.query("DELETE FROM clawscarf_access.login_transactions");
      await assert.rejects(
        service.completeLogin(
          abandoned.cookie,
          "expired-state",
          "http://127.0.0.1:18800/_clawscarf/callback",
        ),
        { code: "administrator_setup_required" },
      );
      assert.equal((await repo.administratorSetup()).complete, false);
      await assert.rejects(callback("replacement"), {
        code: "access_denied",
      });
      assert.equal(await repo.authenticateSession(hash(credential)), null);
      assert.equal((await repo.administratorSetup()).complete, false);
      // A failed admission write must not consume the setup link, even through the locked repository.
      await pool.query(
        "ALTER TABLE clawscarf_access.users ADD CONSTRAINT reject_admission CHECK (NOT admitted)",
      );
      await repo.withEnrollmentLock(async (locked) => {
        await assert.rejects(
          locked.finishAdministratorSetup(
            hash("replacement"),
            bound.id,
            hash("session"),
            "csrf",
            null,
          ),
          { code: "23514" },
        );
      });
      assert.equal((await repo.administratorSetup()).complete, false);
      await pool.query(
        "ALTER TABLE clawscarf_access.users DROP CONSTRAINT reject_admission",
      );
      failNative = false;
      await pool.query(`CREATE FUNCTION clawscarf_access.reject_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.purpose='browser' THEN RAISE EXCEPTION 'session unavailable'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_session BEFORE INSERT ON clawscarf_access.browser_sessions FOR EACH ROW EXECUTE FUNCTION clawscarf_access.reject_session();`);
      await assert.rejects(callback("replacement"), /session unavailable/);
      assert.equal((await repo.administratorSetup()).complete, false);
      await pool.query(
        "DROP TRIGGER reject_session ON clawscarf_access.browser_sessions; DROP FUNCTION clawscarf_access.reject_session()",
      );
      const completed = await callback("replacement");
      assert.equal(completed.returnTo, "/_clawscarf/setup-complete");
      assert.equal(
        (await service.authenticate(completed.session)).user.id,
        bound.id,
      );
      assert.deepEqual(await repo.administratorSetup(), {
        complete: true,
        expiresAt: null,
      });
      assert.equal(await repo.authenticateSession(hash(credential)), null);
      await assert.rejects(callback("replacement"), {
        code: "invalid_authorization",
      });
      await assert.rejects(repo.beginAdministratorSetup(hash("reclaim")), {
        code: "forbidden",
      });
      assert.equal((await callback()).returnTo, "/");
      assert.equal(
        (await new PostgresAccessStore(pool, key, initial).initialize())
          .administrator.id,
        bound.id,
      );
    } finally {
      await pool.query("DROP SCHEMA IF EXISTS clawscarf_access CASCADE");
      await pool.end();
      await oidc.close();
    }
  },
);

await test(
  "invitations bind verified identity, fail closed and consume with admission atomically",
  { skip: !url },
  async () => {
    const { oidcFixture } = await import("./oidc.js");
    const { beginOidcBrowserLogin } = await import("./oidc-http.js");
    const { DeploymentOidcProvider } =
      await import("../../services/access/providers/oidc.js");
    const pool = new pg.Pool({ connectionString: url });
    const oidc = await oidcFixture();
    let app: Awaited<ReturnType<typeof createAccessHttp>> | undefined;
    try {
      await migrate(pool);
      const repo = new PostgresAccessStore(pool, randomBytes(32), {
        issuer: oidc.origin,
        subject: "alice",
        email: "alice@example.test",
        name: "Alice",
      });
      const owner = (await repo.initialize()).administrator;
      const origin = "http://127.0.0.1:18990";
      let uncertain = false;
      let denied = false;
      const native: NativeAuthority = {
        verifyAdministrator: (actor) => {
          if (denied || actor.identity !== owner.identity)
            throw new NativeFailure("access_denied");
          return Promise.resolve({ agentIds: ["main"] });
        },
        observeTeam: () => Promise.resolve("ready"),
        people: () =>
          Promise.resolve({ enrollment: "ready", roles: [], people: [] }),
        prepareTeam: () => Promise.resolve(),
        setRole: () => Promise.resolve(),
        revoke: () => Promise.resolve(),
        enroll: async (actor, credential, person, target) => {
          assert.equal(
            (await repo.authenticateSession(hash(credential)))?.user.identity,
            actor.identity,
          );
          assert.equal(
            (await repo.authenticateSession(hash(target)))?.user.identity,
            person.identity,
          );
          if (uncertain) throw new NativeFailure("outcome_unknown");
        },
      };
      const service = new SessionService(
        repo,
        new DeploymentOidcProvider({
          issuer: oidc.origin,
          clientId: oidc.clientId,
          clientSecret: oidc.clientSecret,
          redirectUri: origin + "/_clawscarf/callback",
        }),
        origin,
        undefined,
        native,
      );
      const team = new EnrollmentService(repo, native, origin, oidc.origin);
      app = await createAccessHttp(service, origin, undefined, team);
      const login = await (await beginOidcBrowserLogin(app, "/")).complete();
      const ownerCookie = login.cookies.find(
        (item) => item.name === "clawscarf_session",
      )?.value;
      assert.ok(ownerCookie);
      const actor = await service.authenticate(ownerCookie);
      const headers = {
        cookie: `clawscarf_session=${ownerCookie}`,
        origin,
        "x-csrf-token": actor.csrfToken,
      };
      const invite = async (email = "bob@example.test") => {
        const response = await app!.inject({
          method: "POST",
          url: "/_clawscarf/invitations",
          headers,
          payload: { email },
        });
        assert.equal(response.statusCode, 200, response.body);
        return z
          .object({ invitation: z.object({ id: z.string() }), url: z.string() })
          .parse(response.json());
      };
      const claim = async (link: string, subject = "bob") => {
        oidc.setUser(subject);
        const secret = new URL(link).searchParams.get("invitation");
        assert.ok(secret);
        return (await beginOidcBrowserLogin(app!, "/", secret)).complete();
      };
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/_clawscarf/invitations",
            cookies: { clawscarf_session: ownerCookie },
            payload: { email: "bob@example.test" },
          })
        ).statusCode,
        403,
      );
      const first = await invite();
      assert.equal((await claim(first.url, "charlie")).statusCode, 400);
      denied = true;
      assert.equal((await claim(first.url)).statusCode, 403);
      denied = false;
      uncertain = true;
      assert.equal((await claim(first.url)).statusCode, 503);
      oidc.setUser("bob");
      assert.equal(
        (await (await beginOidcBrowserLogin(app, "/")).complete()).statusCode,
        403,
      );
      uncertain = false;
      await pool.query(`CREATE FUNCTION clawscarf_access.reject_invited_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.purpose='browser' THEN RAISE EXCEPTION 'session unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_invited_session BEFORE INSERT ON clawscarf_access.browser_sessions FOR EACH ROW EXECUTE FUNCTION clawscarf_access.reject_invited_session();`);
      assert.equal((await claim(first.url)).statusCode, 503);
      assert.equal((await repo.people()).length, 1);
      assert.equal((await repo.invitations())[0]?.status, "pending");
      await pool.query(
        "DROP TRIGGER reject_invited_session ON clawscarf_access.browser_sessions; DROP FUNCTION clawscarf_access.reject_invited_session()",
      );
      const accepted = await claim(first.url);
      assert.equal(accepted.statusCode, 302, accepted.body);
      const memberCookie = accepted.cookies.find(
        (item) => item.name === "clawscarf_session",
      )?.value;
      assert.ok(memberCookie);
      const member = await service.authenticate(memberCookie);
      assert.equal((await claim(first.url)).statusCode, 400);
      assert.equal((await repo.invitations())[0]?.status, "accepted");
      await assert.rejects(team.invite(member, "charlie@example.test"), {
        code: "access_denied",
      });
      const revoked = await invite("charlie@example.test");
      await team.revokeInvitation(actor, revoked.invitation.id);
      assert.equal((await claim(revoked.url, "charlie")).statusCode, 400);
      const expired = await invite("charlie@example.test");
      await pool.query(
        "UPDATE clawscarf_access.invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
        [expired.invitation.id],
      );
      assert.equal((await claim(expired.url, "charlie")).statusCode, 400);
      const stale = await invite("charlie@example.test");
      await repo.removeEnrollment(owner.id);
      await repo.activateEnrollment(owner.id);
      assert.equal((await claim(stale.url, "charlie")).statusCode, 400);
      await repo.removeEnrollment(member.user.id);
      await assert.rejects(service.authenticate(memberCookie), {
        code: "unauthenticated",
      });
      assert.equal(
        (
          await pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM clawscarf_access.browser_sessions WHERE purpose IN ('invitation','enrollment')",
          )
        ).rows[0]?.n,
        0,
      );
    } finally {
      await app?.close();
      await oidc.close();
      await pool.query("DROP SCHEMA IF EXISTS clawscarf_access CASCADE");
      await pool.end();
    }
  },
);
