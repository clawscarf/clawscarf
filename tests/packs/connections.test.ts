import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NativeClaws } from "../../scripts/packs/native.js";
import { planPack, applyPack } from "../../scripts/packs/lifecycle.js";
import { packSchema } from "../../scripts/packs/model.js";
import type { Connection } from "../../services/connections/generated/client/types.gen.js";
class NativeFixture extends NativeClaws {
  writes = 0;
  broker = "";
  constructor() {
    super("unused");
  }
  override version() {
    return Promise.resolve();
  }
  override defaultModel() {
    return Promise.resolve("configured-model");
  }
  override target() {
    return Promise.resolve({
      kind: "openshell" as const,
      sandbox: "test",
      gateway: "test",
      sandboxId: "00000000-0000-4000-8000-000000000003",
    });
  }
  override source(_root: string, _digest: string, existing?: string) {
    return Promise.resolve(existing ?? "/home/node/.clawscarf-pack-test");
  }
  override brokerUrl() {
    return Promise.resolve(this.broker);
  }
  override run(args: readonly string[]) {
    if (args.includes("inspect"))
      return Promise.resolve({
        valid: true,
        manifest: {
          workspace: {
            files: [{ source: "accounts.json", path: "accounts.json" }],
          },
        },
      });
    if (args.includes("--yes")) this.writes++;
    return Promise.resolve({
      schemaVersion: "openclaw.clawAddPlan.v1",
      stability: "experimental",
      planIntegrity: "sha256:" + "a".repeat(64),
    });
  }
}
await test("operator account binding validates target, exact account, grant, revision and current session before native apply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-pack-account-"));
  const source = join(directory, "pack");
  const account: Connection = {
    id: "00000000-0000-4000-8000-000000000001",
    serverId: "00000000-0000-4000-8000-000000000002",
    connectorId: "googledrive",
    name: "Documents",
    grant: { mode: "all" },
    state: "connected",
    generation: 1,
    revision: 1,
    setup: null,
    cleanup: "none",
    failure: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let authenticated = true;
  let requests = 0;
  const server = createServer((request, response) => {
    assert.equal(
      request.url,
      `/_clawscarf/connections/v1/connections/${account.id}`,
    );
    assert.equal(request.headers.cookie, "clawscarf_session=operator-session");
    requests++;
    response.writeHead(authenticated ? 200 : 401, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify(authenticated ? account : { code: "unauthenticated" }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await cp(resolve("packs/research-team"), source, { recursive: true });
    const manifest = packSchema.parse(
      JSON.parse(await readFile(join(source, "pack.json"), "utf8")),
    );
    assert.ok(manifest.members[0]);
    manifest.members[0].connectionFile = "accounts.json";
    manifest.members[0].requirements.connections = [
      { slot: "documents", connectorId: "googledrive" },
    ];
    await writeFile(join(source, "pack.json"), JSON.stringify(manifest));
    const sessionFile = join(directory, "session");
    await writeFile(sessionFile, "operator-session", { mode: 0o600 });
    const bindingsFile = join(directory, "bindings.json");
    await writeFile(
      bindingsFile,
      JSON.stringify({
        origin,
        brokerUrl: origin + "/_clawscarf/connections",
        sessionFile,
        connections: { documents: account.id },
      }),
      { mode: 0o600 },
    );
    const native = new NativeFixture();
    native.broker = origin + "/_clawscarf/connections";
    const input = {
      directory: source,
      member: "researcher",
      workspace: join(directory, "workspace"),
      operation: "add" as const,
      bindingsFile,
    };
    const plan = await planPack(input, native);
    assert.equal(plan.requirements.connections[0]?.connectionId, account.id);
    assert.equal(JSON.stringify(plan).includes("operator-session"), false);
    account.revision++;
    await assert.rejects(
      applyPack(plan, native, bindingsFile),
      /requirements changed/,
    );
    account.revision--;
    account.grant = { mode: "selected", agentIds: ["reviewer"] };
    await assert.rejects(applyPack(plan, native, bindingsFile), /unavailable/);
    account.grant = { mode: "all" };
    authenticated = false;
    await assert.rejects(applyPack(plan, native, bindingsFile));
    authenticated = true;
    native.broker = "https://other.example/_clawscarf/connections";
    const previous = requests;
    await assert.rejects(planPack(input, native), /do not match/);
    assert.equal(requests, previous);
    assert.equal(native.writes, 0);
    native.broker = origin + "/_clawscarf/connections";
    await applyPack(plan, native, bindingsFile);
    assert.equal(native.writes, 1);
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
