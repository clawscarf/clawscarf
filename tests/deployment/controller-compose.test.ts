import { oidcTeam } from "./oidc.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { composeConfiguration } from "../../scripts/deployment/compose.js";
import { parseLocalInput } from "../../scripts/deployment/configuration.js";

await test("controller authority stays outside the application and forwarding publishes only loopback", () => {
  const state = {
    schemaVersion: 1 as const,
    ownerId: "00000000-0000-4000-8000-000000000001",
    input: parseLocalInput({
      cpu: "1",
      memory: "1Gi",
      name: "test",
      administratorName: "Owner",
      runtimeImage: `sha256:${"a".repeat(64)}`,
      companionImage: `sha256:${"b".repeat(64)}`,
      openshellClientImage: `sha256:${"c".repeat(64)}`,
      openshellCli: "/tools/openshell",
      openshellGateway: "/tools/gateway",
      team: oidcTeam(18800, 18802),
      ports: {
        controller: 17671,
        application: 18800,
        widgets: 18802,
        management: 18801,
        native: 18789,
        nativeWidgets: 18790,
        database: 15432,
      },
    }),
  };
  const configuration = composeConfiguration(
    state,
    "/private/team",
    "172.30.0.254",
    undefined,
    undefined,
    987,
  );
  const { controller, application, widgets } = configuration.services;
  assert.equal(controller.networks.runtime.ipv4_address, "172.30.0.254");
  assert.deepEqual(controller.group_add, ["0", "987"]);
  assert.equal(
    controller.user,
    `${String(process.getuid?.() ?? 1000)}:${String(process.getgid?.() ?? 1000)}`,
  );
  assert.equal("execution" in configuration.services, false);
  assert.ok(
    controller.volumes.includes("/var/run/docker.sock:/var/run/docker.sock"),
  );
  assert.ok(
    controller.volumes.includes(
      "/private/team/controller:/private/team/controller",
    ),
  );
  for (const forward of [application, widgets]) {
    assert.deepEqual(forward.volumes, [
      "/private/team/controller/config:/controller/config:ro",
    ]);
    assert.ok(forward.ports.every((port) => port.startsWith("127.0.0.1:")));
    assert.ok(
      forward.command.includes("https://controller.clawscarf.internal:17671"),
    );
    assert.ok(!forward.command.includes("--gateway-insecure"));
    assert.equal(forward.read_only, true);
  }
  const sockets = Object.entries(configuration.services)
    .filter(([, service]) =>
      service.volumes.some((volume) => volume.includes("docker.sock")),
    )
    .map(([name]) => name);
  assert.deepEqual(sockets, ["controller"]);
  assert.ok(
    Object.values(configuration.services).every(
      (service) => Reflect.get(service, "restart") === "unless-stopped",
    ),
  );
});
