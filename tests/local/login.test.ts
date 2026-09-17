import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initializeState } from "../../scripts/local/state.js";
import { verifyLocalAdministrator } from "../../scripts/local/login.js";
import { LocalSetupError } from "../../scripts/local/process.js";

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), "clawscarf-local-login-"));
  const directory = join(parent, "installation");
  const state = await initializeState(directory, {
    name: "team",
    administratorName: "Administrator",
    runtimeImage: `sha256:${"a".repeat(64)}`,
    companionImage: `sha256:${"b".repeat(64)}`,
    openshellCli: "/tools/openshell",
    openshellGateway: "/tools/gateway",
    ports: {
      controller: 17671,
      application: 19000,
      widgets: 19002,
      management: 19001,
      native: 19789,
      nativeWidgets: 19790,
      database: 15432,
    },
    cpu: "2",
    memory: "2Gi",
  });
  const calls = {
    login: 0,
    session: 0,
    people: 0,
    prepare: 0,
    logout: 0,
    codes: 0,
  };
  const behavior: {
    prepare: "success" | "failure" | "hang";
    hangLogin: boolean;
    configuration: string;
  } = { prepare: "success", hangLogin: false, configuration: "initial" };
  const entered = {
    login: Promise.withResolvers<void>(),
    prepare: Promise.withResolvers<void>(),
  };
  const errors: unknown[] = [];
  let origin = "";
  const respond = (reply: ServerResponse, body: unknown, status = 200) => {
    reply.writeHead(status, { "content-type": "application/json" });
    reply.end(JSON.stringify(body));
  };
  async function handle(request: IncomingMessage, reply: ServerResponse) {
    const path = request.url;
    if (path === "/_clawscarf/local") {
      calls.login++;
      assert.equal(request.method, "POST");
      assert.equal(request.headers.origin, origin);
      request.setEncoding("utf8");
      let body = "";
      for await (const chunk of request) {
        assert.equal(typeof chunk, "string");
        body += String(chunk);
      }
      assert.deepEqual(JSON.parse(body), { token: "fixture-one-use-code" });
      entered.login.resolve();
      if (behavior.hangLogin) return;
      reply.setHeader(
        "set-cookie",
        "clawscarf_session=fixture-session; HttpOnly; Path=/",
      );
      respond(reply, { redirect: "/" });
      return;
    }
    assert.equal(request.headers.cookie, "clawscarf_session=fixture-session");
    if (path === "/_clawscarf/session") {
      calls.session++;
      respond(reply, {
        user: {
          id: state.ownerId,
          identity: `clawscarf:${state.ownerId}`,
          name: "Administrator",
          email: "administrator@localhost",
        },
        csrfToken: "fixture-csrf",
        enrollmentEnabled: false,
        links: [],
      });
    } else if (path === "/_clawscarf/people") {
      calls.people++;
      respond(reply, { people: [] });
    } else if (path === "/_clawscarf/team") {
      calls.prepare++;
      assert.equal(request.method, "POST");
      assert.equal(request.headers.origin, origin);
      assert.equal(request.headers["x-csrf-token"], "fixture-csrf");
      assert.deepEqual(
        JSON.parse(
          await readFile(
            join(directory, "native-bootstrap-started.json"),
            "utf8",
          ),
        ),
        { ownerId: state.ownerId },
      );
      entered.prepare.resolve();
      if (behavior.prepare === "hang") return;
      if (behavior.prepare === "failure") {
        respond(
          reply,
          {
            type: "about:blank",
            title: "native_unavailable",
            status: 503,
            code: "native_unavailable",
            detail: "Fixture rejection",
            requestId: "fixture",
          },
          503,
        );
      } else {
        behavior.configuration = "prepared";
        reply.writeHead(204).end();
      }
    } else if (path === "/_clawscarf/logout") {
      calls.logout++;
      assert.equal(request.method, "POST");
      assert.equal(request.headers.origin, origin);
      assert.equal(request.headers["x-csrf-token"], "fixture-csrf");
      respond(reply, { redirect: "/" });
    } else throw Error("Unexpected fixture request.");
  }
  const server = createServer((request, reply) => {
    void handle(request, reply).catch((error: unknown) => {
      errors.push(error);
      respond(reply, { error: "Fixture assertion failed" }, 500);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${String(address.port)}`;
  return {
    directory,
    calls,
    behavior,
    entered,
    state,
    verify(signal = AbortSignal.timeout(5000)) {
      return verifyLocalAdministrator(directory, origin, signal, (selected) => {
        assert.equal(selected, directory);
        calls.codes++;
        return Promise.resolve({
          code: "fixture-one-use-code",
          url: `${origin}/_clawscarf/local-sign-in`,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        });
      });
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
      await rm(parent, { recursive: true, force: true });
      assert.deepEqual(errors, []);
    },
  };
}

await test("initial administrator preparation runs once; repeat verification preserves later configuration and logs out", async () => {
  const app = await fixture();
  try {
    await app.verify();
    assert.equal(app.behavior.configuration, "prepared");
    assert.deepEqual(
      JSON.parse(
        await readFile(join(app.directory, "native-bootstrap.json"), "utf8"),
      ),
      { ownerId: app.state.ownerId },
    );
    app.behavior.configuration = "operator edit";
    await app.verify();
    assert.equal(app.behavior.configuration, "operator edit");
    assert.deepEqual(app.calls, {
      login: 2,
      session: 2,
      people: 2,
      prepare: 1,
      logout: 2,
      codes: 2,
    });
  } finally {
    await app.close();
  }
});

await test("failed preparation retains intent, cleans its session and is never replayed", async () => {
  const app = await fixture();
  try {
    app.behavior.prepare = "failure";
    await assert.rejects(app.verify());
    await assert.rejects(
      readFile(join(app.directory, "native-bootstrap.json")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      app.verify(),
      (error: unknown) =>
        error instanceof LocalSetupError &&
        error.code === "bootstrap_outcome_unknown",
    );
    assert.equal(app.calls.prepare, 1);
    assert.equal(app.calls.logout, 2);
  } finally {
    await app.close();
  }
});

await test("aborted preparation retains intent, uses a fresh cleanup signal and is never replayed", async () => {
  const app = await fixture();
  try {
    app.behavior.prepare = "hang";
    const controller = new AbortController();
    const outcome = assert.rejects(app.verify(controller.signal));
    await app.entered.prepare.promise;
    controller.abort();
    await outcome;
    assert.equal(app.calls.logout, 1);
    await assert.rejects(
      app.verify(),
      (error: unknown) =>
        error instanceof LocalSetupError &&
        error.code === "bootstrap_outcome_unknown",
    );
    assert.equal(app.calls.prepare, 1);
    assert.equal(app.calls.logout, 2);
  } finally {
    await app.close();
  }
});

await test("hanging login aborts without retry or a bootstrap mutation", async () => {
  const app = await fixture();
  try {
    app.behavior.hangLogin = true;
    const controller = new AbortController();
    const outcome = assert.rejects(app.verify(controller.signal));
    await app.entered.login.promise;
    controller.abort();
    await outcome;
    assert.deepEqual(app.calls, {
      login: 1,
      session: 0,
      people: 0,
      prepare: 0,
      logout: 0,
      codes: 1,
    });
    await assert.rejects(
      readFile(join(app.directory, "native-bootstrap-started.json")),
      { code: "ENOENT" },
    );
  } finally {
    await app.close();
  }
});
