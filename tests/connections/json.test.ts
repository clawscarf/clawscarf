import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJson } from "../../services/connections/shared/json.js";
import { requireConnectorJson } from "../../services/connections/types/validation.js";
import { parseCatalogJson } from "../../services/connections/providers/catalog/artifact.js";
import { jsonValue } from "../../services/connections/providers/composio/wire.js";

await test("JSON boundaries preserve their depth, byte and object-shape rules", () => {
  let nested: unknown = null;
  for (let depth = 0; depth < 65; depth++) nested = [nested];
  assert.throws(() => requireConnectorJson(nested), {
    code: "invalid_request",
  });
  assert.deepEqual(parseCatalogJson(nested, 1024), nested);
  assert.deepEqual(jsonValue(nested, "not_started"), nested);
  assert.throws(() => requireConnectorJson("é", 3), {
    code: "invalid_request",
  });
  assert.throws(() => parseCatalogJson("é", 3), /byte limit/);
  assert.equal(requireConnectorJson("é", 4), "é");
  const unusual = new Date(0);
  assert.throws(() => requireConnectorJson(unusual), {
    code: "invalid_request",
  });
  assert.deepEqual(parseCatalogJson(unusual, 100), {});
  assert.deepEqual(jsonValue(unusual, "not_started"), {});
});

await test("invalid, cyclic and excessive JSON preserves the owning boundary's failure", () => {
  const cycle: unknown[] = [];
  cycle.push(cycle);
  for (const value of [
    undefined,
    Number.NaN,
    cycle,
    Array.from({ length: 250_000 }, () => null),
  ]) {
    assert.throws(() => requireConnectorJson(value), {
      code: "invalid_request",
    });
    assert.throws(() => parseCatalogJson(value, 2 * 1024 * 1024));
    for (const completion of ["not_started", "outcome_unknown"] as const)
      assert.throws(() => jsonValue(value, completion), {
        code: "connector_provider_invalid_response",
        completion,
      });
  }
});

await test("JSON copies preserve reserved keys and canonical digests ignore object ordering", () => {
  const value: unknown = JSON.parse(
    '{"z":1,"__proto__":{"safe":true},"a":[{"b":2,"a":1}]}',
  );
  const parsed = requireConnectorJson(value);
  assert.deepEqual(parsed, value);
  assert.notEqual(parsed, value);
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(
    canonicalJson(parsed),
    '{"__proto__":{"safe":true},"a":[{"a":1,"b":2}],"z":1}',
  );
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
});
