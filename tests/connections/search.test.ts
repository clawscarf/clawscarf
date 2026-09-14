import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConnectorCatalog } from "../../services/connections/providers/catalog/import-artifacts.js";
import { FileConnectorCatalog } from "../../services/connections/providers/catalog/provider.js";
import { readCatalogIndex } from "../../services/connections/providers/catalog/validation.js";
import { EncryptedConnectionProtection } from "../../services/connections/providers/protection.js";
import { searchConnections } from "../../services/connections/service/search.js";
import type {
  ConnectorCatalogQuery,
  ConnectorJson,
} from "../../services/connections/types/catalog.js";
import type { ConnectionRecord } from "../../services/connections/types/model.js";

function catalog(count = 105) {
  const raw: ConnectorJson[] = Array.from({ length: count }, (_, index) => ({
    slug: `MAIL_ACTION_${String(index).padStart(3, "0")}`,
    name: `Action ${index}`,
    description: "Find a document.",
    version: "20260910_00",
    input_parameters: { type: "object" },
  }));
  const files = buildConnectorCatalog(
    {
      source: {
        repository: "https://example.test/catalog",
        revision: "1".repeat(40),
        paths: ["manifest.json"],
      },
      connectors: [
        {
          id: "mail",
          toolkitSlug: "provider_mail",
          name: "Mail",
          description: "Mail service",
          category: "Test",
          iconUrl: "https://example.test/mail.svg",
          auth: { kind: "managed" },
        },
      ],
    },
    new Map([["mail", raw]]),
  );
  const json = files.get("index.json");
  assert.ok(json);
  const index: unknown = JSON.parse(json);
  return new FileConnectorCatalog(readCatalogIndex(index), () => {
    throw Error("Search must not load action schemas.");
  });
}
function connection(id: string): ConnectionRecord {
  return {
    serverId: "install",
    id,
    connectorId: "mail",
    name: `Mail ${id}`,
    grant: { mode: "all" },
    state: "connected",
    generation: 1,
    revision: 1,
    activeAccountId: `provider-${id}`,
    failure: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
}
function fixture() {
  return {
    catalog: catalog(),
    connections: [connection("second"), connection("first")],
    protection: new EncryptedConnectionProtection(
      Buffer.alloc(32, 5),
      "fixture",
    ),
    binding: "install",
    authority: {
      credentialId: "credential",
      credentialGeneration: 1,
      agentId: "agent",
    },
  };
}

await test("runtime search paginates every exact account/action pair across catalog pages", () => {
  const input = fixture();
  const pairs: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const query: ConnectorCatalogQuery = {
      limit: 25,
      ...(cursor ? { cursor } : {}),
    };
    const page = searchConnections({ ...input, query });
    assert.ok(page.items.length <= 25);
    assert.ok((page.nextCursor?.length ?? 0) <= 2000);
    pairs.push(
      ...page.items.map((match) => `${match.action.id}/${match.connection.id}`),
    );
    cursor = page.nextCursor ?? undefined;
    assert.ok(++pages <= 9);
  } while (cursor);
  assert.equal(pairs.length, 210);
  assert.equal(new Set(pairs).size, 210);
  assert.deepEqual(pairs.slice(0, 4), [
    "MAIL_ACTION_000/first",
    "MAIL_ACTION_000/second",
    "MAIL_ACTION_001/first",
    "MAIL_ACTION_001/second",
  ]);
  assert.deepEqual(pairs.slice(-2), [
    "MAIL_ACTION_104/first",
    "MAIL_ACTION_104/second",
  ]);
});

await test("search cursors are invalidated by current visibility, generation, revision and caller authority", () => {
  const input = fixture();
  const first = searchConnections({ ...input, query: { limit: 25 } });
  assert.ok(first.nextCursor);
  const query = { cursor: first.nextCursor, limit: 25 };
  assert.equal(
    searchConnections({
      ...input,
      connections: [...input.connections].reverse(),
      query,
    }).items[0]?.connection.id,
    "second",
  );
  const variants = [
    { ...input, connections: input.connections.slice(1) },
    {
      ...input,
      connections: input.connections.map((row) => ({
        ...row,
        generation: row.generation + 1,
      })),
    },
    {
      ...input,
      connections: input.connections.map((row) => ({
        ...row,
        revision: row.revision + 1,
      })),
    },
    { ...input, authority: { ...input.authority, agentId: "another-agent" } },
    { ...input, authority: { ...input.authority, credentialGeneration: 2 } },
    { ...input, binding: "another-install" },
    { ...input, catalog: catalog(106) },
  ];
  for (const variant of variants)
    assert.throws(() => searchConnections({ ...variant, query }), {
      code: "invalid_request",
    });
  assert.throws(
    () =>
      searchConnections({ ...input, query: { ...query, text: "document" } }),
    { code: "invalid_request" },
  );
  assert.throws(
    () =>
      searchConnections({
        ...input,
        query: { ...query, connectionId: "first" },
      }),
    { code: "invalid_request" },
  );
});

await test("search filters exact accounts and enforces bounds without manufacturing matches", () => {
  const input = fixture();
  assert.equal(searchConnections({ ...input, query: {} }).items.length, 10);
  const single = searchConnections({
    ...input,
    query: { connectionId: "first", limit: 25 },
  });
  assert.equal(single.items.length, 25);
  assert.ok(single.items.every((match) => match.connection.id === "first"));
  assert.deepEqual(
    searchConnections({ ...input, query: { connectorId: "not-visible" } }),
    { items: [], nextCursor: null },
  );
  assert.deepEqual(
    searchConnections({ ...input, connections: [], query: {} }),
    { items: [], nextCursor: null },
  );
  assert.deepEqual(
    searchConnections({ ...input, query: { text: "no-matching-action" } }),
    { items: [], nextCursor: null },
  );
  for (const query of [
    { limit: 0 },
    { limit: 26 },
    { text: "x".repeat(501) },
    { cursor: "!" },
    { cursor: "" },
    {
      cursor: Buffer.from(
        JSON.stringify({
          page: null,
          action: 99,
          connection: 0,
          signature: "forged",
        }),
      ).toString("base64url"),
    },
  ])
    assert.throws(() => searchConnections({ ...input, query }), {
      code: "invalid_request",
    });
  assert.throws(
    () =>
      searchConnections({
        ...input,
        connections: Array.from({ length: 501 }, (_, index) =>
          connection(`account-${index}`),
        ),
        query: {},
      }),
    { code: "connector_capacity_exceeded" },
  );
});
