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
            assert.equal(profile.displayName, "Qualification member");
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
