import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { GatewayClient } from "@openclaw/gateway-client";
import { readConfiguration } from "../../services/access/runtime/config.js";
import { composeAccess } from "../../services/access/runtime/composition.js";
import { EnrollmentService } from "../../services/access/service/enrollment.js";
import { withGateway } from "../../services/access/providers/gateway.js";
import {
  readState,
  profileFor,
} from "../../services/access/providers/native-state.js";
import { hash, token } from "../../services/access/service/session.js";
const configPath = process.env.CLAWSCARF_NATIVE_TEST_CONFIG;
const sessionPath = process.env.CLAWSCARF_NATIVE_TEST_SESSION_FILE;
await test(
  "real native concurrent ingress, member denial, administrator promotion and stream revocation",
  { skip: !configPath || !sessionPath, timeout: 60000 },
  async () => {
    assert.ok(configPath && sessionPath);
    const config = await readConfiguration(configPath);
    const app = await composeAccess(config);
    let socket: GatewayClient | undefined;
    let cleanupId: string | undefined;
    const failures: unknown[] = [];
    const actor = await app.access.authenticate(
      (await readFile(sessionPath, "utf8")).trim(),
    );
    const team = new EnrollmentService(
      app.repository,
      app.native,
      config.origin,
      "https://qualification.clawscarf.test",
    );
    try {
      const browserCredential = (await readFile(sessionPath, "utf8")).trim();
      await Promise.all(
        Array.from({ length: 40 }, async () => {
          const response = await fetch(config.origin, {
            headers: { cookie: `clawscarf_session=${browserCredential}` },
            signal: AbortSignal.timeout(10_000),
            redirect: "error",
          });
          assert.equal(response.status, 200);
          assert.match(
            response.headers.get("content-type") ?? "",
            /text\/html/,
          );
          assert.match(await response.text(), /<html/i);
        }),
      );
      const fixture = {
        issuer: "https://qualification.clawscarf.test",
        subject: token(),
        email: "member@example.test",
        name: "Qualification member",
        emailVerified: false,
      };
      // Track the pending fixture too, so a failed native enrollment cleans its grant.
      cleanupId = (await app.repository.prepareEnrollment(fixture)).id;
      const person = await team.enroll(actor, fixture);
      const credential = token();
      await app.repository.createSession(
        person.id,
        hash(credential),
        token(),
        null,
      );
      const member = await app.access.authenticate(credential);
      await assert.rejects(
        app.access.withActingSession(member.hash, (value) =>
          app.native.verifyAdministrator(
            { identity: person.identity, sessionHash: member.hash },
            value,
          ),
        ),
        { code: "access_denied" },
      );
      await app.access.withActingSession(actor.hash, (value) =>
        withGateway(
          {
            origin: config.origin,
            ...(config.runtime.managementOrigin
              ? { endpoint: config.runtime.managementOrigin }
              : {}),
            credential: value,
          },
          async (gateway) => {
            const profile = profileFor(
              (await readState(gateway)).profiles,
              person.identity,
            );
            assert.ok(profile);
            assert.equal(profile.role, "member");
            assert.equal(profile.displayName, "member@example.test");
            await gateway.mutate("users.setRole", {
              profileId: profile.id,
              role: "admin",
            });
          },
        ),
      );
      await app.access.withActingSession(member.hash, (value) =>
        app.native.verifyAdministrator(
          { identity: person.identity, sessionHash: member.hash },
          value,
        ),
      );
      const connected = Promise.withResolvers<void>(),
        closed = Promise.withResolvers<void>();
      const url = new URL(config.runtime.managementOrigin ?? config.origin);
      url.protocol = "wss:";
      socket = new GatewayClient({
        url: url.href,
        origin: config.origin,
        edgeAuthHeaders: {
          Host: new URL(config.origin).host,
          Cookie: `clawscarf_session=${credential}`,
        },
        clientName: "gateway-client",
        clientVersion: "2026.9.4",
        mode: "backend",
        role: "operator",
        minProtocol: 4,
        maxProtocol: 4,
        scopes: ["operator.admin"],
        deviceIdentity: null,
        hostDeps: { logDebug() {}, logError() {} },
        onHelloOk: () => connected.resolve(),
        onConnectError: (error) => connected.reject(error),
        onClose: () => closed.resolve(),
      });
      socket.start();
      await connected.promise;
      await team.remove(member, person.id);
      cleanupId = undefined;
      await Promise.race([
        closed.promise,
        delay(6000).then(() => {
          throw Error("Revoked native connection remained open.");
        }),
      ]);
      await assert.rejects(app.access.authenticate(credential), {
        code: "unauthenticated",
      });
      assert.equal(
        (
          await app.access.authenticate(
            (await readFile(sessionPath, "utf8")).trim(),
          )
        ).user.id,
        actor.user.id,
      );
    } catch (error) {
      failures.push(error);
    } finally {
      socket?.stop();
      try {
        if (cleanupId) await team.remove(actor, cleanupId);
      } catch (error) {
        failures.push(error);
      }
      try {
        await app.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Native test or fixture cleanup failed.",
      );
  },
);

await test(
  "signed OIDC native enrollment, administrator handover, rejoin and targeted logout",
  { skip: !configPath || !sessionPath, timeout: 180000 },
  async () => {
    assert.ok(configPath && sessionPath);
    const { oidcFixture } = await import("./oidc.js");
    const { beginOidcBrowserLogin } = await import("./oidc-http.js");
    const { SessionService } =
      await import("../../services/access/service/session.js");
    const { DeploymentOidcProvider } =
      await import("../../services/access/providers/oidc.js");
    const { createAccessHttp } =
      await import("../../services/access/runtime/http.js");
    const config = await readConfiguration(configPath);
    const app = await composeAccess(config);
    const oidc = await oidcFixture(true);
    const sessions = new SessionService(
      app.repository,
      new DeploymentOidcProvider({
        issuer: oidc.origin,
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        redirectUri: config.origin + "/_clawscarf/callback",
      }),
      config.origin,
      undefined,
      app.native,
    );
    const team = new EnrollmentService(
      app.repository,
      app.native,
      config.origin,
      oidc.origin,
    );
    const http = await createAccessHttp(
      sessions,
      config.origin,
      undefined,
      team,
    );
    const cleanup = new Set<string>();
    const sockets: GatewayClient[] = [];
    const failures: unknown[] = [];
    const ownerCredential = (await readFile(sessionPath, "utf8")).trim();
    const owner = await app.access.authenticate(ownerCredential);
    const first = {
      subject: "first-" + token(),
      email: "",
      name: "OIDC first member",
    };
    const second = {
      subject: "second-" + token(),
      email: "",
      name: "OIDC second member",
    };
    first.email = first.subject.toLowerCase() + "@example.test";
    second.email = second.subject.toLowerCase() + "@example.test";
    const headers = async (credential: string) => ({
      cookie: "clawscarf_session=" + credential,
      origin: config.origin,
      "x-csrf-token": (await sessions.authenticate(credential)).csrfToken,
    });
    const people = (credential: string) =>
      http.inject({
        url: "/_clawscarf/people",
        cookies: { clawscarf_session: credential },
      });
    async function login(subject: string) {
      oidc.setUser(subject);
      const result = await (await beginOidcBrowserLogin(http, "/")).complete();
      assert.equal(result.statusCode, 302);
      assert.equal(result.headers.location, "/");
      const cookie = result.cookies.find(
        (value) => value.name === "clawscarf_session",
      );
      assert.ok(cookie?.value);
      return cookie.value;
    }
    async function enroll(credential: string, person: typeof first) {
      // Track pending native grants too, so a failed enrollment remains cleanable.
      const pending = await app.repository.prepareEnrollment({
        ...person,
        issuer: oidc.origin,
        emailVerified: false,
      });
      cleanup.add(pending.id);
      const result = await http.inject({
        method: "POST",
        url: "/_clawscarf/people",
        headers: await headers(credential),
        payload: person,
      });
      assert.equal(result.statusCode, 200, result.body);
      return pending;
    }
    async function promote(credential: string, identity: string) {
      const actor = await sessions.authenticate(credential);
      const observed = await team.list(actor);
      const person = observed.people.find(
        (person) => person.identity === identity,
      );
      assert.ok(person);
      assert.equal(person.role, "member");
      const result = await http.inject({
        method: "PUT",
        url: `/_clawscarf/people/${person.id}/role`,
        headers: await headers(credential),
        payload: { role: "admin", expectedRole: "member" },
      });
      assert.equal(result.statusCode, 200, result.body);
    }
    async function stream(credential: string, scopes: string[]) {
      const connected = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      let hasClosed = false;
      const url = new URL(config.runtime.managementOrigin ?? config.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new GatewayClient({
        url: url.href,
        origin: config.origin,
        edgeAuthHeaders: {
          Host: new URL(config.origin).host,
          Cookie: "clawscarf_session=" + credential,
        },
        clientName: "gateway-client",
        clientVersion: "2026.9.4",
        mode: "backend",
        role: "operator",
        minProtocol: 4,
        maxProtocol: 4,
        scopes,
        deviceIdentity: null,
        requestTimeoutMs: 10000,
        hostDeps: { logDebug() {}, logError() {} },
        onHelloOk: () => connected.resolve(),
        onConnectError: (error) => connected.reject(error),
        onClose: () => {
          hasClosed = true;
          closed.resolve();
        },
      });
      sockets.push(socket);
      socket.start();
      await Promise.race([
        connected.promise,
        delay(15000).then(() => {
          throw Error("Native fixture connection did not open.");
        }),
      ]);
      return { socket, closed: closed.promise, hasClosed: () => hasClosed };
    }
    try {
      // This fixture issuer is served only by the injected test handlers. The
      // running companion's local/OIDC configuration and owner remain unchanged.
      oidc.setUser(first.subject);
      assert.equal(
        (await (await beginOidcBrowserLogin(http, "/")).complete()).statusCode,
        403,
      );
      const firstPerson = await enroll(ownerCredential, first);
      const firstCredential = await login(first.subject);
      assert.equal(
        (await sessions.authenticate(firstCredential)).user.id,
        firstPerson.id,
      );
      assert.equal((await people(firstCredential)).statusCode, 403);
      await promote(ownerCredential, firstPerson.identity);
      assert.equal((await people(firstCredential)).statusCode, 200);
      const invitation = await team.invite(
        await sessions.authenticate(firstCredential),
        second.email,
      );
      const secret = new URL(invitation.url).searchParams.get("invitation");
      assert.ok(secret);
      oidc.setUser(second.subject);
      const accepted = await (
        await beginOidcBrowserLogin(http, "/", secret)
      ).complete();
      assert.equal(accepted.statusCode, 302, accepted.body);
      const secondCredential = accepted.cookies.find(
        (cookie) => cookie.name === "clawscarf_session",
      )?.value;
      assert.ok(secondCredential);
      const secondPerson = (await sessions.authenticate(secondCredential)).user;
      cleanup.add(secondPerson.id);
      assert.equal(
        (await (await beginOidcBrowserLogin(http, "/", secret)).complete())
          .statusCode,
        400,
      );
      assert.equal(
        (await sessions.authenticate(secondCredential)).user.id,
        secondPerson.id,
      );
      assert.equal((await people(secondCredential)).statusCode, 403);
      await promote(firstCredential, secondPerson.identity);
      assert.equal((await people(secondCredential)).statusCode, 200);

      await team.setRole(
        await sessions.authenticate(secondCredential),
        firstPerson.id,
        "member",
        "admin",
      );
      assert.equal((await people(firstCredential)).statusCode, 403);
      const removed = await http.inject({
        method: "DELETE",
        url: "/_clawscarf/people/" + firstPerson.id,
        headers: await headers(secondCredential),
      });
      assert.equal(removed.statusCode, 200, removed.body);
      cleanup.delete(firstPerson.id);
      assert.equal((await people(firstCredential)).statusCode, 401);
      assert.equal((await people(secondCredential)).statusCode, 200);
      oidc.setUser(first.subject);
      assert.equal(
        (await (await beginOidcBrowserLogin(http, "/")).complete()).statusCode,
        403,
      );

      const rejoined = await enroll(secondCredential, first);
      assert.equal(rejoined.id, firstPerson.id);
      assert.equal((await people(firstCredential)).statusCode, 401);
      const freshCredential = await login(first.subject);
      assert.equal(
        (await people(freshCredential)).statusCode,
        403,
        "Rejoining must not retain the former administrator role.",
      );
      const revoked = await stream(freshCredential, []);
      const surviving = await stream(secondCredential, ["operator.admin"]);
      const logout = await http.inject({
        method: "POST",
        url: "/_clawscarf/logout",
        headers: await headers(freshCredential),
      });
      assert.equal(logout.statusCode, 200);
      await Promise.race([
        revoked.closed,
        delay(6000).then(() => {
          throw Error("Logged-out OIDC connection remained open.");
        }),
      ]);
      assert.equal((await people(freshCredential)).statusCode, 401);
      assert.equal(
        surviving.hasClosed(),
        false,
        "Another identity's native stream must remain connected.",
      );
      await surviving.socket.request<unknown>("exec.approvals.get", {});
      assert.equal((await people(secondCredential)).statusCode, 200);
      assert.equal(
        (await app.access.authenticate(ownerCredential)).user.id,
        owner.user.id,
      );
    } catch (error) {
      failures.push(error);
    } finally {
      for (const socket of sockets) socket.stop();
      for (const id of cleanup) {
        try {
          await team.remove(owner, id);
        } catch (error) {
          failures.push(error);
        }
      }
      for (const close of [
        () => http.close(),
        () => app.close(),
        () => oidc.close(),
      ]) {
        try {
          await close();
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Native OIDC test or fixture cleanup failed.",
      );
  },
);
