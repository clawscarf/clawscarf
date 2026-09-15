import assert from "node:assert/strict";
import { test } from "node:test";
import { initialConfiguration } from "../../runtime/configuration.js";

const input = {
  publicOrigin: "http://127.0.0.1:18800",
  widgetOrigin: "http://127.0.0.1:18802",
  administratorIdentity: "clawscarf:c9cd693a-5af1-42d3-8673-3a45e9ff4e21",
};
await test("fresh configuration rejects remote cleartext and shared widget origin", () => {
  assert.throws(() =>
    initialConfiguration({ ...input, publicOrigin: "http://team.example.com" }),
  );
  assert.throws(() =>
    initialConfiguration({ ...input, widgetOrigin: input.publicOrigin }),
  );
  assert.throws(() =>
    initialConfiguration({
      ...input,
      publicOrigin: "https://team.example.com/path",
    }),
  );
});
await test("native callbacks and generated links use the same public origin as browser entry", () => {
  const publicOrigin = "https://team.example.com";
  const config = initialConfiguration({ ...input, publicOrigin });
  assert.equal(config.gateway.publicOrigin, publicOrigin);
  assert.deepEqual(config.gateway.controlUi.allowedOrigins, [publicOrigin]);
  assert.equal(config.mcp.apps.sandboxOrigin, input.widgetOrigin);
});
await test("initial admission is one explicit identity, with required member isolation", () => {
  const config = initialConfiguration(input);
  assert.deepEqual(config.gateway.auth.trustedProxy.allowUsers, [
    input.administratorIdentity,
  ]);
  assert.equal(config.gateway.roles.definitions.member.sandbox, "required");
  assert.equal(
    config.gateway.roles.definitions.member.scopes.includes("operator.admin"),
    false,
  );
});
await test("hosted ingress can supply its identity without standalone account navigation", () => {
  const identity = "rawclaw:6b5dd932-8a12-411e-870a-802959cb54cc";
  const config = initialConfiguration({
    ...input,
    administratorIdentity: identity,
    standaloneNavigation: false,
  });
  assert.deepEqual(config.gateway.auth.trustedProxy.allowUsers, [identity]);
  assert.deepEqual(config.gateway.auth.identityScopes[identity], [
    "operator.admin",
  ]);
  assert.equal(
    config.plugins.load.paths.includes("/app/clawscarf/access"),
    false,
  );
  assert.equal(config.gateway.controlUi.experimental.customPlugins, false);
  assert.throws(() =>
    initialConfiguration({ ...input, administratorIdentity: "admin\nspoof" }),
  );
});
await test("native Codex keeps bundled provenance while Lobster is explicitly loaded", () => {
  const config = initialConfiguration(input);
  assert.equal(config.plugins.entries.codex.enabled, true);
  assert.equal(
    config.plugins.entries.codex.config.sessionCatalog.enabled,
    false,
  );
  assert.ok(
    config.plugins.load.paths.includes(
      "/app/clawscarf/native-plugins/node_modules/@openclaw/lobster",
    ),
  );
  assert.ok(config.plugins.load.paths.every((path) => !path.includes("codex")));
});
