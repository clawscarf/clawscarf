import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  writeFile,
  rm,
  chmod,
  readFile,
  mkdir,
} from "node:fs/promises";
import { once } from "node:events";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCertificates } from "../../scripts/deployment/certificates.js";
import {
  readTeamMaterials,
  prepareTeamFiles,
  probeTeamAccess,
} from "../../scripts/deployment/team.js";
import {
  parseLocalInput,
  generateLocalConfiguration,
} from "../../scripts/deployment/configuration.js";
import { composeConfiguration } from "../../scripts/deployment/compose.js";

const base = {
  name: "team",
  administratorName: "Ada",
  runtimeImage: `sha256:${"a".repeat(64)}`,
  companionImage: `sha256:${"b".repeat(64)}`,
  openshellCli: "/tools/cli",
  openshellGateway: "/tools/gateway",
  openshellClientImage: `sha256:${"a".repeat(64)}`,
  cpu: "2",
  memory: "2Gi",
  ports: {
    controller: 17671,
    application: 18443,
    widgets: 18444,
    management: 18445,
    native: 18789,
    nativeWidgets: 18790,
    database: 15432,
  },
  team: {
    origin: "https://localhost:18443",
    widgetOrigin: "https://127.0.0.1:18444",
    certificateFile: "/private/public.pem",
    keyFile: "/private/key.pem",
    clientSecretFile: "/private/client-secret",
    issuer: "https://id.example/realm",
    clientId: "team",
    administratorSubject: "exact-subject",
    administratorEmail: "ada@example.com",
  },
};
await test("team profile rejects insecure origins, publication mismatches and missing explicit identity", () => {
  for (const change of [
    { origin: "http://localhost:18443" },
    { widgetOrigin: base.team.origin },
    { origin: "https://localhost:18446" },
    { issuer: "http://id.example" },
    { issuer: "https://id.example?secret=x" },
    { administratorSubject: "" },
    { clientSecretFile: "relative" },
  ])
    assert.throws(() =>
      parseLocalInput({ ...base, team: { ...base.team, ...change } }),
    );
});
await test("team generation publishes TLS browser ports only and keeps identity out of native credentials", () => {
  const input = parseLocalInput(base);
  const generated = generateLocalConfiguration({
    input,
    directory: "/private/team",
    encryptionKeyPath: "/private/team/encryption.key",
    managementCertificatePath: "/private/team/management-cert.pem",
    managementKeyPath: "/private/team/management-key.pem",
    runtimeDatabaseUrl: "postgres://runtime:secret@postgres/clawscarf",
    administratorIdentity: "clawscarf:00000000-0000-4000-8000-000000000001",
  });
  assert.equal(generated.access.identity.mode, "oidc");
  assert.equal(generated.access.origin, base.team.origin);
  assert.equal(generated.native.gateway.publicOrigin, base.team.origin);
  assert.equal(generated.native.mcp.apps.sandboxOrigin, base.team.widgetOrigin);
  assert.deepEqual(generated.access.applicationTls, {
    certificateFile: "/run/clawscarf/application-cert.pem",
    keyFile: "/run/clawscarf/application-key.pem",
  });
  assert.ok(!JSON.stringify(generated.native).includes("exact-subject"));
  const compose = composeConfiguration(
    {
      schemaVersion: 1,
      ownerId: "00000000-0000-4000-8000-000000000001",
      input,
    },
    "/private/team",
    "172.30.0.254",
  );
  assert.deepEqual(compose.services.companion.ports, [
    "0.0.0.0:18443:18800",
    "127.0.0.1:18445:18801",
    "0.0.0.0:18444:18800",
  ]);
  assert.deepEqual(compose.services.postgres.ports, ["127.0.0.1:15432:5432"]);
  assert.ok(
    compose.services.companion.volumes.some((value) =>
      value.endsWith("/oidc-client-secret:ro"),
    ),
  );
});
await test("team material validation checks private files, both certificate names and immutable resume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-team-"));
  try {
    await ensureCertificates(directory);
    const secret = join(directory, "source-secret");
    await writeFile(secret, "fixture-secret", { mode: 0o600 });
    const team = {
      ...base.team,
      certificateFile: join(directory, "management-cert.pem"),
      keyFile: join(directory, "management-key.pem"),
      clientSecretFile: secret,
    };
    const materials = await readTeamMaterials(team);
    await prepareTeamFiles(directory, materials);
    await prepareTeamFiles(directory, materials);
    assert.equal(
      await readFile(join(directory, "oidc-client-secret"), "utf8"),
      "fixture-secret",
    );
    await assert.rejects(
      prepareTeamFiles(directory, { ...materials, secret: "changed" }),
    );
    await assert.rejects(
      readTeamMaterials({
        ...team,
        widgetOrigin: "https://uncovered.example:18444",
      }),
    );
    await chmod(secret, 0o644);
    await assert.rejects(readTeamMaterials(team), {
      code: "invalid_team_configuration",
    });
    await chmod(secret, 0o600);
    await writeFile(secret, " ");
    await assert.rejects(readTeamMaterials(team), {
      code: "invalid_team_configuration",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("team probe authenticates private TLS independently of the public routing Host", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-team-probe-"));
  const privateDirectory = join(directory, "private");
  await mkdir(privateDirectory, { mode: 0o700 });
  await ensureCertificates(privateDirectory);
  let healthy = true;
  const server = createServer(
    {
      cert: await readFile(join(privateDirectory, "management-cert.pem")),
      key: await readFile(join(privateDirectory, "management-key.pem")),
    },
    (req, res) => {
      assert.equal(req.headers.host, "team.example.com:18443");
      assert.equal(req.url, "/_clawscarf/health");
      res.writeHead(healthy ? 200 : 503).end();
    },
  );
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const input = parseLocalInput({
      ...base,
      ports: { ...base.ports, management: address.port },
      team: { ...base.team, origin: "https://team.example.com:18443" },
    });
    await probeTeamAccess(directory, input, AbortSignal.timeout(3000));
    healthy = false;
    await assert.rejects(
      probeTeamAccess(directory, input, AbortSignal.timeout(3000)),
      { code: "native_unavailable" },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      }),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
