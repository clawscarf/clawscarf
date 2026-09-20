import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import pins from "../../release/components.json" with { type: "json" };
import { prepareLocal } from "../../scripts/deployment/prepare.js";
import { launchLocal, stopLocal } from "../../scripts/deployment/launch.js";
import { resourceNames, readState } from "../../scripts/deployment/state.js";
import { run } from "../../scripts/deployment/process.js";
import {
  liteLlmImage,
  postgresImage,
} from "../../scripts/deployment/images.js";
import { deleteInstallation } from "../../scripts/installation/delete.js";
import { checkHost } from "../../scripts/installation/prerequisites.js";

const imageFile = process.env.CLAWSCARF_TEST_PLATFORM_IMAGES;
await test(
  "real Docker platform: protected runtime, private model gateway, retention and cleanup",
  {
    skip: !imageFile,
    timeout: 600_000,
  },
  async () => {
    assert.ok(imageFile);
    await checkHost();
    const images = z
      .object({
        runtime: z.string(),
        companion: z.string(),
        "openshell-client": z.string(),
      })
      .parse(JSON.parse(await readFile(imageFile, "utf8")));
    const host = z
      .enum(["darwin-arm64", "linux-arm64", "linux-x64"])
      .parse(`${process.platform}-${process.arch}`);
    const directory = await mkdtemp(resolve(".local/platform-install-"));
    const stateDirectory = join(directory, "state");
    const secret = async (name: string, value: string) => {
      const path = join(directory, name);
      await writeFile(path, value, { mode: 0o600 });
      return path;
    };
    let allocated = false;
    try {
      for (const name of ["cli", "gateway"] as const) {
        const pin = pins.openshell[name][host];
        const response = await fetch(pin.url, {
          signal: AbortSignal.timeout(180_000),
        });
        assert.ok(response.ok);
        const data = Buffer.from(await response.arrayBuffer());
        assert.equal(
          createHash("sha256").update(data).digest("hex"),
          pin.sha256,
        );
        const archive = join(directory, `${name}.tgz`);
        await writeFile(archive, data, { mode: 0o600 });
        await run("tar", ["-xzf", archive, "-C", directory]);
      }
      for (const image of [
        postgresImage,
        liteLlmImage,
        pins.openshell.gatewayImage,
      ])
        await run("docker", ["pull", image], { timeout: 180_000 });
      const configurationFile = await secret(
        "models.json",
        JSON.stringify({
          defaultModel: "fixture",
          models: [
            {
              id: "fixture",
              name: "Fixture",
              enabled: true,
              contextWindow: 8192,
              maxTokens: 1024,
              reasoning: false,
              tools: true,
              input: ["text"],
              route: {
                model: "openai/gpt-4o-mini",
                apiKeyEnv: "OPENAI_API_KEY",
              },
            },
          ],
        }),
      );
      const upstreamEnvironmentFile = await secret(
        "models.env",
        "OPENAI_API_KEY=unused-platform-test\n",
      );
      const modelPort = 18408;
      allocated = true;
      const state = await prepareLocal(stateDirectory, {
        name: "platform-test",
        administratorName: "Test administrator",
        cpu: "2",
        memory: "3Gi",
        runtimeImage: images.runtime,
        companionImage: images.companion,
        openshellClientImage: images["openshell-client"],
        openshellCli: join(directory, "openshell"),
        openshellGateway: join(directory, "openshell-gateway"),
        ports: {
          controller: 18400,
          management: 18401,
          native: 18402,
          nativeWidgets: 18403,
          database: 18404,
          application: 18405,
          widgets: 18406,
        },
        team: {
          origin: "http://127.0.0.1:18405",
          widgetOrigin: "http://127.0.0.1:18406",
          issuer: "https://identity.example.test",
          clientId: "fixture",
          clientSecretFile: await secret("oidc-secret", "unused"),
          administratorSubject: "platform-admin",
          administratorEmail: "platform@example.test",
        },
        modelGateway: {
          configurationFile,
          upstreamEnvironmentFile,
          image: liteLlmImage,
          port: modelPort,
        },
        models: {
          configurationFile: join(stateDirectory, "private/models/native.json"),
          runtimeKeyFile: join(stateDirectory, "private/models/runtime-key"),
          caFile: join(stateDirectory, "private/management-ca.pem"),
        },
      });
      await launchLocal(stateDirectory, console.log);
      const name = resourceNames(state).sandbox;
      const env = {
        ...process.env,
        XDG_CONFIG_HOME: join(stateDirectory, "controller/config"),
        XDG_STATE_HOME: join(stateDirectory, "controller/state"),
        XDG_DATA_HOME: join(stateDirectory, "controller/data"),
      };
      const inside = (code: string) =>
        run(
          state.input.openshellCli,
          [
            "sandbox",
            "exec",
            "--name",
            name,
            "--gateway",
            name,
            "--no-tty",
            "--timeout",
            "30",
            "--",
            "node",
            "-e",
            code,
          ],
          { env, timeout: 45_000 },
        );
      // Real TLS and scoped credentials across the runtime bridge, through OpenShell's Node policy.
      assert.match(
        await inside(
          `const fs=require('fs'),https=require('https');const c=JSON.parse(fs.readFileSync('/home/node/.openclaw/clawscarf-models/initial.json'));https.get('https://models.clawscarf.internal:4000/v1/models',{ca:fs.readFileSync('/home/node/.openclaw/clawscarf-models/ca.pem'),headers:{Authorization:'Bearer '+c.token}},r=>{if(r.statusCode!==200)process.exit(2);r.resume();r.on('end',()=>{fs.writeFileSync('/home/node/platform-retained','retained');console.log('models reachable')})}).on('error',e=>{console.log('model network error',e.code)});`,
        ),
        /models reachable/,
      );
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket("ws://127.0.0.1:18402");
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error("Native WebSocket challenge timed out."));
        }, 10_000);
        socket.onmessage = (message) => {
          clearTimeout(timer);
          socket.close();
          if (
            typeof message.data === "string" &&
            message.data.includes('"event":"connect.challenge"')
          )
            resolve();
          else reject(new Error("Missing native WebSocket challenge."));
        };
        socket.onerror = () => {
          clearTimeout(timer);
          reject(new Error("Native WebSocket forwarding failed."));
        };
      });
      const response = await fetch("http://127.0.0.1:18405/_clawscarf/health", {
        redirect: "manual",
      });
      assert.equal(response.status, 200);
      await stopLocal(stateDirectory);
      await launchLocal(stateDirectory, console.log);
      assert.match(
        await inside(
          "console.log(require('fs').readFileSync('/home/node/platform-retained','utf8'))",
        ),
        /retained/,
      );
    } catch (error) {
      if (allocated) {
        const state = await readState(stateDirectory);
        const ids = (
          await run("docker", [
            "ps",
            "-aq",
            "--filter",
            `label=com.docker.compose.project=${resourceNames(state).project}`,
          ])
        )
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        if (ids.length)
          console.error(
            await run("docker", [
              "inspect",
              "--format",
              "{{json .Name}} {{json .State.Status}} {{json .State.ExitCode}} {{json .State.Error}}",
              ...ids,
            ]),
          );
      }
      throw error;
    } finally {
      if (allocated) await deleteInstallation(stateDirectory);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
