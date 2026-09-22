import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  prepareProductTelemetry,
  claimSetupCompletion,
} from "./product-telemetry.js";

await test("installation telemetry has its own stable identity and claims readiness only once", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "clawscarf-product-telemetry-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = await prepareProductTelemetry(directory, {});
  assert.ok(first);
  assert.equal(
    (await prepareProductTelemetry(directory, {}))?.installationId,
    first.installationId,
  );
  const claims = await Promise.all([
    claimSetupCompletion(directory),
    claimSetupCompletion(directory),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.find(Boolean)?.installationId, first.installationId);
  assert.equal(await claimSetupCompletion(directory), undefined);
  assert.doesNotMatch(
    await readFile(join(directory, "product-telemetry.json"), "utf8"),
    /operator|email|invocation/,
  );
});

await test("opted-out setup creates no telemetry identity", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-product-optout-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(
    await prepareProductTelemetry(directory, {
      CLAWSCARF_TELEMETRY_DISABLED: "1",
    }),
    undefined,
  );
  assert.deepEqual(await readdir(directory), []);
  assert.equal(await claimSetupCompletion(directory), undefined);
});

await test("runtime configuration gets only installation telemetry and explicit observational hook permission", async (t) => {
  const { initialConfiguration } = await import("../runtime/configuration.js");
  const { withProductTelemetry } = await import("./product-telemetry.js");
  const { initialRuntimePolicy } = await import("./deployment/policy.js");
  const directory = await mkdtemp(join(tmpdir(), "clawscarf-product-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = await prepareProductTelemetry(directory, {});
  assert.ok(config);
  const native = initialConfiguration({
    publicOrigin: "https://team.example",
    widgetOrigin: "https://widgets.example",
    agentName: "Assistant",
    administratorIdentity: "private-person",
  });
  const enabled = withProductTelemetry(native, config);
  assert.ok("env" in enabled);
  assert.equal(
    enabled.env.vars.CLAWSCARF_TELEMETRY_INSTALLATION_ID,
    config.installationId,
  );
  assert.ok("hooks" in enabled.plugins.entries["clawscarf-access"]);
  assert.equal(
    enabled.plugins.entries["clawscarf-access"].hooks.allowConversationAccess,
    true,
  );
  assert.equal(withProductTelemetry(native, undefined), native);
  const rule = initialRuntimePolicy(
    "network_policies: {}",
    undefined,
    undefined,
    false,
    config.host,
  ).network_policies.product_analytics;
  assert.deepEqual(rule, {
    name: "Product analytics",
    endpoints: [{ host: "eu.i.posthog.com", port: 443, tls: "skip" }],
    binaries: [{ path: "/usr/local/bin/node" }],
  });
});
