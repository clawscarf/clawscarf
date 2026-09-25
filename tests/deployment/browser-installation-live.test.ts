import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { promisify } from "node:util";
import { test } from "node:test";
import { GatewayClient } from "@openclaw/gateway-client";
import { z } from "zod";
import release from "../../runtime/current.json" with { type: "json" };
import { readState, resourceNames } from "../../scripts/deployment/state.js";
import { run } from "../../scripts/deployment/process.js";
import { deleteInstallation } from "../../scripts/installation/delete.js";
import { readConfiguration } from "../../services/access/runtime/config.js";
import { openAccessStorage } from "../../services/access/runtime/storage.js";
import { hash, token } from "../../services/access/service/session.js";

const execute = promisify(execFile);
const bytes = Buffer.from(
  "ClawScarf browser installation round trip\n\0\u00ff",
  "utf8",
);
const inbound = "/home/node/.openclaw/media/inbound/browser-proof.bin";
const workspace = "/home/node/.openclaw/workspace/browser-proof.bin";

await test(
  "released standalone installation: browser transfers, restart and retained On/Off",
  {
    skip: process.env.CLAWSCARF_TEST_BROWSER_INSTALLATION !== "1",
    timeout: 1_500_000,
  },
  async () => {
    const platform = z
      .enum(["linux-arm64", "linux-x64", "darwin-arm64"])
      .parse(`${process.platform}-${process.arch}`);
    const recipe = z
      .enum(["team-server", "personal-assistant"])
      .parse(process.env.CLAWSCARF_TEST_BROWSER_RECIPE ?? "team-server");
    await mkdir(resolve(".local"), { recursive: true });
    const root = await mkdtemp(resolve(".local/browser-install-"));
    const installation = join(root, "installation");
    const directory = join(installation, "state");
    const env = { ...process.env, CLAWSCARF_TELEMETRY_DISABLED: "1" };
    const command = async (executable: string, args: string[]) => {
      // This disposable fixture contains only synthetic credentials and data.
      try {
        const result = await execute(executable, args, {
          env,
          timeout: 900_000,
          maxBuffer: 4 * 1024 * 1024,
        });
        return result.stdout;
      } catch (error) {
        if (
          error instanceof Error &&
          "stderr" in error &&
          typeof error.stderr === "string"
        )
          console.error(error.stderr);
        throw error;
      }
    };
    const sourceCli = (args: string[]) =>
      command(process.execPath, [resolve("scripts/clawscarf.mjs"), ...args]);
    try {
      const base = `https://github.com/clawscarf/clawscarf/releases/download/v${release.version}`;
      const archiveName = `clawscarf-${release.version}-${platform}.tgz`;
      const download = async (name: string) => {
        const response = await fetch(`${base}/${name}`, {
          signal: AbortSignal.timeout(180_000),
        });
        assert.ok(response.ok, `Download ${name}: ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
      };
      const checksums = (await download("SHA256SUMS")).toString("utf8");
      const expected = checksums
        .split("\n")
        .find((line) => line.endsWith(`  ${archiveName}`))
        ?.split(/\s+/)[0];
      assert.match(expected ?? "", /^[a-f0-9]{64}$/);
      const archive = await download(archiveName);
      assert.equal(
        createHash("sha256").update(archive).digest("hex"),
        expected,
      );
      await writeFile(join(root, "standalone.tgz"), archive, { mode: 0o600 });
      await command("tar", ["-xzf", join(root, "standalone.tgz"), "-C", root]);
      const standalone = join(root, "clawscarf/clawscarf");
      for (const name of ["oidc-secret", "provider-key"])
        await writeFile(join(root, name), "unused-browser-test", {
          mode: 0o600,
        });
      console.log(
        `Installing ${release.version} on ${platform} with ${recipe}.`,
      );
      await command(standalone, [
        "configure",
        "--directory",
        installation,
        "--recipe",
        recipe,
        "--access",
        "oidc",
        "--oidc-issuer",
        "https://identity.example.test",
        "--oidc-client-id",
        "browser-fixture",
        "--oidc-secret-file",
        join(root, "oidc-secret"),
        "--administrator-subject",
        "browser-admin",
        "--administrator-email",
        "browser@example.test",
        "--ai-service",
        "provider",
        "--provider",
        "openai",
        "--model",
        "gpt-6-astra",
        "--llm-key-file",
        join(root, "provider-key"),
        "--no-connections",
        "--browser",
        "--public-web",
        "--port",
        "18405",
        "--widget-port",
        "18406",
        "--non-interactive",
        "--yes",
        "--start",
        "--json",
      ]);
      const state = await readState(directory);
      assert.equal(state.input.runtimeImage, release.images.gateway);
      assert.equal(state.input.browser?.image, release.images.browser.chromium);
      const names = resourceNames(state);
      const inside = (code: string) =>
        run(
          state.input.openshellCli,
          [
            "sandbox",
            "exec",
            "--name",
            names.sandbox,
            "--gateway",
            names.sandbox,
            "--no-tty",
            "--timeout",
            "30",
            "--",
            "node",
            "-e",
            code,
          ],
          {
            env: {
              ...env,
              XDG_CONFIG_HOME: join(directory, "controller/config"),
              XDG_STATE_HOME: join(directory, "controller/state"),
              XDG_DATA_HOME: join(directory, "controller/data"),
            },
            timeout: 45_000,
          },
        );
      const verify = async (mode: "first" | "retained" | "off") => {
        const access = await readConfiguration(
          join(directory, "private/access.json"),
        );
        const database = new URL(access.databaseUrl);
        database.hostname = "127.0.0.1";
        database.port = String(state.input.ports.database);
        const storage = await openAccessStorage({
          ...access,
          databaseUrl: database.href,
          encryptionKeyFile: join(directory, "private/encryption.key"),
        });
        const certificates = getCACertificates("default");
        setDefaultCACertificates([
          ...certificates,
          await readFile(join(directory, "private/management-ca.pem"), "utf8"),
        ]);
        const credential = token();
        let client: GatewayClient | undefined;
        try {
          // Supply a synthetic administrator session; the real Access/native/node transports remain intact.
          // This test does not qualify an external OIDC provider or real model inference.
          await storage.repository.createSession(
            storage.identity.administrator.id,
            hash(credential),
            token(),
            null,
          );
          const connected = Promise.withResolvers<void>();
          client = new GatewayClient({
            url: `wss://localhost:${state.input.ports.management}`,
            origin: access.origin,
            edgeAuthHeaders: {
              Host: new URL(access.origin).host,
              Cookie: `clawscarf_session=${credential}`,
            },
            clientName: "gateway-client",
            mode: "backend",
            scopes: ["operator.admin"],
            deviceIdentity: null,
            hostDeps: { logDebug() {}, logError() {} },
            onHelloOk: () => connected.resolve(),
            onConnectError: connected.reject,
          });
          const timer = setTimeout(
            () => connected.reject(Error("Administrator connection timed out")),
            15_000,
          );
          try {
            client.start();
            await connected.promise;
          } finally {
            clearTimeout(timer);
          }
          const tools = z
            .object({
              groups: z.array(
                z.object({ tools: z.array(z.object({ id: z.string() })) }),
              ),
            })
            .parse(
              await client.request("tools.effective", {
                agentId: "main",
                sessionKey: "agent:main:browser-qualification",
              }),
            );
          assert.equal(
            tools.groups
              .flatMap((group) => group.tools)
              .some((tool) => tool.id === "browser"),
            mode !== "off",
          );
          if (mode === "off") return;
          const request = (
            method: string,
            path: string,
            body?: Record<string, unknown>,
          ) =>
            client!.request(
              "browser.request",
              {
                method,
                path,
                ...(body ? { body } : {}),
                timeoutMs: 30_000,
              },
              { timeoutMs: 40_000 },
            );
          // No explicit target, node or profile: exercise the installation's normal routing.
          const { targetId } = z
            .object({ targetId: z.string() })
            .parse(
              await request("POST", "/tabs/open", {
                url: "https://example.com",
              }),
            );
          try {
            const act = (body: Record<string, unknown>) =>
              request("POST", "/act", { ...body, targetId });
            const heading = z
              .object({ result: z.string() })
              .parse(
                await act({
                  kind: "evaluate",
                  fn: "() => document.querySelector('h1').textContent",
                }),
              );
            assert.equal(heading.result, "Example Domain");
            if (mode === "retained") {
              const cookie = z
                .object({ result: z.string() })
                .parse(
                  await act({ kind: "evaluate", fn: "() => document.cookie" }),
                );
              assert.match(cookie.result, /clawscarf_browser_test=retained/);
              assert.equal(
                (
                  await inside(
                    `console.log(require('fs').readFileSync(${JSON.stringify(workspace)}).toString('base64'))`,
                  )
                ).trim(),
                bytes.toString("base64"),
              );
            } else {
              await act({
                kind: "evaluate",
                fn: "() => { document.cookie='clawscarf_browser_test=retained; Path=/; Max-Age=3600; SameSite=Lax'; return true; }",
              });
            }
            await inside(
              `const fs=require('fs');fs.mkdirSync(require('path').dirname(${JSON.stringify(inbound)}),{recursive:true});fs.writeFileSync(${JSON.stringify(inbound)},Buffer.from(${JSON.stringify(bytes.toString("base64"))},'base64'));fs.copyFileSync(${JSON.stringify(inbound)},${JSON.stringify(workspace)});console.log('staged');`,
            );
            // Build a synthetic page in this tab. No uploaded bytes leave the test browser.
            await act({
              kind: "evaluate",
              fn: `() => { document.body.innerHTML='<input id="upload" type="file"><a id="download">Download</a>';const a=document.querySelector('#download');a.href=URL.createObjectURL(new Blob([new Uint8Array(${JSON.stringify([...bytes])})]));a.download='browser-round-trip.bin';return true; }`,
            });
            await assert.rejects(
              request("POST", "/hooks/file-chooser", {
                targetId,
                element: "#upload",
                paths: [workspace],
              }),
            );
            await request("POST", "/hooks/file-chooser", {
              targetId,
              element: "#upload",
              paths: [inbound],
            });
            const uploaded = z
              .object({ result: z.array(z.number()) })
              .parse(
                await act({
                  kind: "evaluate",
                  fn: "async () => Array.from(new Uint8Array(await document.querySelector('#upload').files[0].arrayBuffer()))",
                }),
              );
            assert.deepEqual(Buffer.from(uploaded.result), bytes);
            const downloaded = z
              .object({
                downloads: z.array(z.object({ path: z.string() })).length(1),
              })
              .parse(await act({ kind: "click", selector: "#download" }));
            const saved = downloaded.downloads[0]!.path;
            assert.ok(
              saved.startsWith("/home/node/.openclaw/media/browser/"),
              saved,
            );
            assert.equal(
              (
                await inside(
                  `const fs=require('fs');fs.copyFileSync(${JSON.stringify(saved)},${JSON.stringify(workspace)});console.log(fs.readFileSync(${JSON.stringify(workspace)}).toString('base64'));`,
                )
              ).trim(),
              bytes.toString("base64"),
            );
            await assert.rejects(
              request("POST", "/tabs/open", { url: "http://127.0.0.1:18405" }),
            );
            console.log(
              `${mode}: exact upload/download bytes through authenticated node; workspace copy and private-destination rejection passed.`,
            );
          } finally {
            await request("DELETE", `/tabs/${encodeURIComponent(targetId)}`);
          }
        } finally {
          await client?.stopAndWait({ timeoutMs: 2000 });
          await storage.repository.revokeSession(hash(credential));
          await storage.close();
          setDefaultCACertificates(certificates);
        }
      };
      await verify("first");
      await command(standalone, [
        "stop",
        "--directory",
        installation,
        "--json",
      ]);
      await command(standalone, [
        "start",
        "--directory",
        installation,
        "--json",
      ]);
      await verify("retained");
      for (const enabled of [false, true]) {
        await sourceCli([
          "configure",
          "--directory",
          installation,
          enabled ? "--browser" : "--no-browser",
          "--non-interactive",
          "--yes",
          "--json",
        ]);
        await verify(enabled ? "retained" : "off");
      }
      console.log(
        `${platform}: ${recipe}, ${release.version}; restart, Browser Off/On and retained cookies/files passed.`,
      );
    } finally {
      // Delete only this test's owned installation, including volumes and networks.
      const exists = await readFile(join(directory, "identity.json")).then(
        () => true,
        (error: unknown) => {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
            return false;
          throw error;
        },
      );
      if (exists) await deleteInstallation(directory);
      await rm(root, { recursive: true, force: true });
    }
  },
);
