import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";
import { deriveBrokerContract } from "../scripts/derive-contract.ts";

await test("the portable broker contract is derived from the service, with no management authority", async () => {
  const source: unknown = JSON.parse(
    await readFile(
      new URL("../../../services/cloud/openapi.json", import.meta.url),
      "utf8",
    ),
  );
  const derived = deriveBrokerContract(source);
  const published: unknown = parse(
    await readFile(new URL("../openapi/broker.yaml", import.meta.url), "utf8"),
  );
  assert.deepEqual(published, derived);
  assert.ok(
    Object.keys(derived.paths).every((path) =>
      path.startsWith("/connector-runtime/"),
    ),
  );
  assert.deepEqual(Object.keys(derived.components.securitySchemes ?? {}), [
    "InstallationRuntime",
  ]);
  assert.equal(derived.components.schemas?.Connection, undefined);
});

await test("contract derivation follows transitive references and rejects dangling references", () => {
  const source = {
    openapi: "3.1.0",
    info: { version: "1" },
    "x-clawscarf-broker-base-path": "/broker",
    "x-clawscarf-runtime-security": "ConnectorRuntime",
    paths: {
      "/broker/call": {
        post: {
          security: [{ ConnectorRuntime: [] }],
          responses: { "200": { $ref: "#/components/schemas/Outer" } },
        },
      },
    },
    components: {
      securitySchemes: { ConnectorRuntime: { type: "http", scheme: "bearer" } },
      schemas: {
        Outer: {
          properties: { child: { $ref: "#/components/schemas/Inner" } },
        },
        Inner: { type: "string" },
        Unused: {},
      },
    },
  };
  const result = deriveBrokerContract(source);
  assert.deepEqual(Object.keys(result.components.schemas ?? {}), [
    "Outer",
    "Inner",
  ]);
  assert.ok(result.paths["/call"]);
  source.components.schemas.Outer.properties.child.$ref =
    "#/components/schemas/Missing";
  assert.throws(
    () => deriveBrokerContract(source),
    /Missing contract reference/u,
  );
});
