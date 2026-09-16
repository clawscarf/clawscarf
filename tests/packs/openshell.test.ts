import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OpenShellClaws } from "../../scripts/packs/openshell.js";
import { planPack, applyPack } from "../../scripts/packs/lifecycle.js";
import { packSchema } from "../../scripts/packs/model.js";
await test(
  "operator bindings install as native owned files on the exact OpenShell runtime",
  {
    skip:
      !process.env.CLAWSCARF_TEST_PACK_SANDBOX ||
      !process.env.CLAWSCARF_TEST_PACK_WORKER,
    timeout: 240000,
  },
  async () => {
    const sandbox = process.env.CLAWSCARF_TEST_PACK_SANDBOX;
    assert.ok(sandbox);
    const options = {
      sandbox,
      workerSandbox: process.env.CLAWSCARF_TEST_PACK_WORKER ?? "",
      gateway: process.env.CLAWSCARF_TEST_PACK_GATEWAY ?? "clawscarf",
      executable: process.env.CLAWSCARF_TEST_OPENSHELL ?? "openshell",
      python: process.env.CLAWSCARF_TEST_PACK_PYTHON ?? "python3",
    };
    const directory = await mkdtemp(join(tmpdir(), "clawscarf-pack-live-"));
    const source = join(directory, "pack");
    const id = "00000000-0000-4000-8000-000000000001";
    let allowed = true;
    let revision = 1;
    const server = createServer((request, response) => {
      assert.equal(
        request.headers.cookie,
        "clawscarf_session=operator-proof-session",
      );
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id,
          serverId: "00000000-0000-4000-8000-000000000002",
          connectorId: "googledrive",
          name: revision === 1 ? "Documents" : "Team documents",
          revision,
          state: "connected",
          grant: !allowed
            ? { mode: "selected", agentIds: [] }
            : revision === 1
              ? { mode: "all" }
              : { mode: "selected", agentIds: ["researcher"] },
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    // Account HTTP is controlled; native target, package ownership and SDK transport are real.
    class Target extends OpenShellClaws {
      override brokerUrl() {
        return Promise.resolve(origin + "/_clawscarf/connections");
      }
    }
    const native = new Target(options);
    async function file(command: string, path: string, content = "") {
      const target = await native.target();
      assert.equal(target.kind, "openshell");
      if (target.kind !== "openshell") throw Error("Expected OpenShell target");
      const child = promisify(execFile)(
        options.python,
        ["scripts/packs/transport.py"],
        { timeout: 120000 },
      );
      child.child.stdin?.end(
        JSON.stringify({
          gateway: options.gateway,
          sandboxId: target.sandboxId,
          command: ["node", "-e", command, path, content],
          stdin: "",
        }),
      );
      return (await child).stdout;
    }
    try {
      await cp(resolve("packs/research-team"), source, { recursive: true });
      const manifest = packSchema.parse(
        JSON.parse(await readFile(join(source, "pack.json"), "utf8")),
      );
      const member = manifest.members[0];
      assert.ok(member);
      member.connectionFile = "accounts.json";
      member.requirements = {
        model: "none",
        connections: [{ slot: "documents", connectorId: "googledrive" }],
      };
      await writeFile(join(source, "pack.json"), JSON.stringify(manifest));
      const claw = join(source, member.source, "CLAW.md");
      await writeFile(
        claw,
        (await readFile(claw, "utf8")).replace(
          "  bootstrapFiles: {}",
          "  bootstrapFiles: {}\n  files:\n    - source: accounts.json\n      path: accounts.json",
        ) + "\nRead accounts.json for the exact documents account.\n",
      );
      await writeFile(join(source, member.source, "accounts.json"), "{}\n");
      const sessionFile = join(directory, "session");
      await writeFile(sessionFile, "operator-proof-session", { mode: 0o600 });
      const bindingsFile = join(directory, "bindings.json");
      await writeFile(
        bindingsFile,
        JSON.stringify({
          origin,
          brokerUrl: origin + "/_clawscarf/connections",
          sessionFile,
          connections: { documents: id },
        }),
        { mode: 0o600 },
      );
      const workspace = `/home/node/workspaces/pack-account-proof-${randomUUID()}`;
      const input = {
        directory: source,
        member: member.id,
        workspace,
        operation: "add" as const,
        bindingsFile,
      };
      const plan = await planPack(input, native);
      allowed = false;
      await assert.rejects(
        applyPack(plan, native, bindingsFile),
        /unavailable/,
      );
      allowed = true;
      await applyPack(plan, native, bindingsFile);
      const content = await file(
        "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'))",
        workspace + "/accounts.json",
      );
      assert.match(content, new RegExp(id));
      assert.match(content, /Documents/);
      assert.equal(content.includes("operator-proof-session"), false);
      revision = 2;
      const update = await planPack({ ...input, operation: "update" }, native);
      await applyPack(update, native, bindingsFile);
      assert.match(
        await file(
          "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'))",
          workspace + "/accounts.json",
        ),
        /Team documents/,
      );
      await file(
        "require('fs').writeFileSync(process.argv[1],process.argv[2])",
        workspace + "/accounts.json",
        "Human-edited account note",
      );
      const removal = await planPack({ ...input, operation: "remove" }, native);
      await applyPack(removal, native, bindingsFile);
      assert.equal(
        await file(
          "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'))",
          workspace + "/accounts.json",
        ),
        "Human-edited account note",
      );
    } finally {
      server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
