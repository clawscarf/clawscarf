import assert from "node:assert/strict";
import { test } from "node:test";
import { createComposioProvider } from "../../services/connections/providers/composio/provider.js";
import {
  ConnectorProviderError,
  type ConnectorProviderBinding,
} from "../../services/connections/types/provider.js";

const key = "dedicated-project-secret-for-provider-test";
const binding: ConnectorProviderBinding = {
  accountId: "ca_exact",
  subjectId: "rawclaw_user",
  toolkit: "example",
  authConfigurationId: "ac_exact",
};
const signal = () => new AbortController().signal;
const account = (overrides: Record<string, unknown> = {}) => ({
  id: binding.accountId,
  user_id: binding.subjectId,
  toolkit: { slug: binding.toolkit },
  auth_config: { id: binding.authConfigurationId },
  status: "ACTIVE",
  alias: "Work account",
  ...overrides,
});
const execution = {
  binding,
  actionId: "EXAMPLE_ACTION",
  version: "20260910_00",
  arguments: { undocumented: null, numberProvidedAsString: "7" },
};

function fixture(responses: (Response | Error)[]) {
  const calls: { url: string; body: unknown; method: string | undefined }[] =
    [];
  const provider = createComposioProvider({
    apiKey: key,
    fetchImpl: (url, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-api-key"), key);
      assert.equal(init?.redirect, "error");
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({
        url: url instanceof Request ? url.url : String(url),
        body,
        method: init?.method,
      });
      const next = responses.shift();
      assert.ok(next, "Unexpected additional provider request");
      if (next instanceof Error) throw next;
      return Promise.resolve(next);
    },
  });
  return { provider, calls };
}

await test("direct execution preserves opaque arguments and selects the exact account and version without hidden I/O", async () => {
  const { provider, calls } = fixture([
    Response.json({ successful: true, data: { unexpectedOutput: null } }),
  ]);
  const result = await provider.execute(execution, signal());
  assert.deepEqual(result, {
    status: "succeeded",
    result: { kind: "inline", data: { unexpectedOutput: null } },
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.url,
    "https://backend.composio.dev/api/v3.1/tools/execute/EXAMPLE_ACTION",
  );
  assert.deepEqual(calls[0]?.body, {
    connected_account_id: binding.accountId,
    user_id: binding.subjectId,
    version: execution.version,
    arguments: execution.arguments,
  });
});

await test("provider rejections preserve useful bounded diagnostics without classifying their prose or disclosing credentials", async () => {
  for (const message of [
    "invalid date: expected YYYY-MM-DD",
    "timeout unavailable error but parameter is required",
  ]) {
    const { provider, calls } = fixture([
      Response.json(
        {
          error: {
            message: `${message}; api_key=${key}; password=hunter2; https://example.test?token=secret`,
          },
        },
        { status: 422 },
      ),
    ]);
    const result = await provider.execute(execution, signal());
    assert.equal(result.status, "rejected");
    assert.equal(result.failure.code, "connector_provider_rejected");
    assert.ok(result.failure.message.includes(message));
    assert.doesNotMatch(
      result.failure.message,
      /hunter2|project-secret|token=secret/,
    );
    assert.equal(calls.length, 1);
  }
  const { provider } = fixture([
    Response.json({
      successful: false,
      error: { message: "Field date is required" },
    }),
  ]);
  const result = await provider.execute(execution, signal());
  assert.ok(result.status === "rejected");
  assert.match(result.failure.message, /Field date is required/);
});

await test("transport loss and malformed post-dispatch results remain unknown and are never replayed", async () => {
  for (const response of [
    new TypeError("socket closed with sensitive token"),
    new Response("not-json"),
    Response.json({ data: {} }),
    Response.json({ error: "upstream broke" }, { status: 503 }),
  ]) {
    const { provider, calls } = fixture([response]);
    const result = await provider.execute(execution, signal());
    assert.equal(result.status, "outcome_unknown");
    assert.equal(result.failure.retry.strategy, "reconcile");
    assert.doesNotMatch(result.failure.message, /sensitive token/);
    assert.equal(calls.length, 1);
  }
});

await test("known provider success survives an unavailable payload; pre-dispatch cancellation makes no request", async () => {
  const { provider, calls } = fixture([Response.json({ successful: true })]);
  assert.deepEqual(await provider.execute(execution, signal()), {
    status: "succeeded",
    result: { kind: "unavailable", reason: "invalid_result" },
  });
  const controller = new AbortController();
  controller.abort();
  const cancelled = await provider.execute(execution, controller.signal);
  assert.ok(cancelled.status === "rejected");
  assert.equal(cancelled.failure.completion, "not_started");
  assert.equal(calls.length, 1);
});

await test("same-service setup creates distinct hosted accounts with the generic public wire contract", async () => {
  const { provider, calls } = fixture(
    [1, 2].map((id) =>
      Response.json({
        connected_account_id: `ca_${id}`,
        expires_at: "2026-09-10T12:00:00Z",
        redirect_url: `https://connect.example.test/${id}`,
      }),
    ),
  );
  const input = {
    authConfigurationId: binding.authConfigurationId,
    subjectId: binding.subjectId,
    callbackUrl: "https://rawclaw.example.test/connections/verify",
  };
  const first = await provider.createSetup(input, signal());
  const second = await provider.createSetup(input, signal());
  assert.notEqual(first.accountId, second.accountId);
  assert.deepEqual(
    calls.map((call) => call.body),
    [1, 2].map(() => ({
      auth_config_id: input.authConfigurationId,
      user_id: input.subjectId,
      callback_url: input.callbackUrl,
    })),
  );
});

await test("managed and custom authentication share the same generic adapter and exact paginated selection", async () => {
  const managed = {
    id: "managed",
    toolkit: { slug: "example" },
    is_composio_managed: true,
    status: "ENABLED",
  };
  const found = fixture([
    Response.json({ items: [], next_cursor: "next" }),
    Response.json({ items: [managed], next_cursor: null }),
  ]);
  assert.deepEqual(
    await found.provider.resolveAuthConfiguration(
      { toolkit: "example", auth: { kind: "managed" } },
      signal(),
    ),
    { id: "managed", toolkit: "example", auth: { kind: "managed" } },
  );
  assert.equal(new URL(found.calls[1]!.url).searchParams.get("cursor"), "next");
  const custom = {
    id: "custom",
    toolkit: { slug: "another_service" },
    is_composio_managed: false,
    auth_scheme: "API_KEY",
    status: "ENABLED",
  };
  const created = fixture([
    Response.json({ items: [] }),
    Response.json({ auth_config: custom }),
    Response.json({ items: [custom] }),
  ]);
  const result = await created.provider.resolveAuthConfiguration(
    { toolkit: "another_service", auth: { kind: "custom", scheme: "API_KEY" } },
    signal(),
  );
  assert.equal(result.id, "custom");
  assert.deepEqual(created.calls[1]?.body, {
    toolkit: { slug: "another_service" },
    auth_config: {
      type: "use_custom_auth",
      authScheme: "API_KEY",
      credentials: {},
    },
  });
});

await test("inspection and cleanup reject a mismatched owner before deleting; cleanup preserves its revocation receipt", async () => {
  for (const mismatch of [
    { user_id: "foreign_user" },
    { id: "foreign_account" },
    { auth_config: { id: "foreign_config" } },
    { toolkit: { slug: "foreign_toolkit" } },
  ]) {
    const { provider, calls } = fixture([Response.json(account(mismatch))]);
    await assert.rejects(
      provider.deleteAccount(binding, signal()),
      (error: unknown) =>
        error instanceof ConnectorProviderError &&
        error.code === "connector_account_mismatch",
    );
    assert.equal(calls.length, 1);
  }
  const { provider, calls } = fixture([
    Response.json(account()),
    Response.json({ success: true, revoke_job_id: "revoke_job" }),
  ]);
  assert.deepEqual(await provider.deleteAccount(binding, signal()), {
    status: "deleted",
    revocationJobId: "revoke_job",
  });
  assert.equal(calls[1]?.method, "DELETE");
  assert.equal(
    new URL(calls[1].url).searchParams.get("revoke_on_delete"),
    "true",
  );
});

await test("identity verification forwards an opaque session to the configured API, never fetches a callback URL", async () => {
  const { provider, calls } = fixture([
    Response.json({
      connected_account_id: binding.accountId,
      toolkit_slug: binding.toolkit,
    }),
  ]);
  assert.deepEqual(
    await provider.completeIdentity(
      {
        sessionRef: "https://provider.example.test/session",
        subjectId: binding.subjectId,
      },
      signal(),
    ),
    { accountId: binding.accountId, toolkit: binding.toolkit },
  );
  assert.equal(
    calls[0]?.url,
    "https://backend.composio.dev/api/v3.1/connected_accounts/complete_auth",
  );
  assert.deepEqual(calls[0]?.body, {
    session_uri: "https://provider.example.test/session",
    user_id: binding.subjectId,
  });
});

await test("identity verification preserves the authenticated subject across concurrent setup accounts", async () => {
  const { provider, calls } = fixture([
    Response.json({
      connected_account_id: "ca_second",
      toolkit_slug: "second_service",
    }),
    Response.json({
      connected_account_id: "ca_first",
      toolkit_slug: "first_service",
    }),
  ]);
  const second = await provider.completeIdentity(
    { sessionRef: "opaque-second", subjectId: binding.subjectId },
    signal(),
  );
  const first = await provider.completeIdentity(
    { sessionRef: "opaque-first", subjectId: binding.subjectId },
    signal(),
  );
  assert.deepEqual(
    [second, first],
    [
      { accountId: "ca_second", toolkit: "second_service" },
      { accountId: "ca_first", toolkit: "first_service" },
    ],
  );
  assert.deepEqual(
    calls.map((call) => call.body),
    [
      { session_uri: "opaque-second", user_id: binding.subjectId },
      { session_uri: "opaque-first", user_id: binding.subjectId },
    ],
  );
});

await test("identity redemption omits provider prose from public problems without changing typed status or completion", async () => {
  const cases = [
    {
      status: 400,
      publicStatus: 400,
      code: "connector_provider_rejected",
      completion: "rejected",
    },
    {
      status: 403,
      publicStatus: 503,
      code: "connector_provider_authentication",
      completion: "rejected",
    },
    {
      status: 429,
      publicStatus: 429,
      code: "connector_provider_rate_limited",
      completion: "rejected",
    },
    {
      status: 503,
      publicStatus: 503,
      code: "connector_provider_unknown_outcome",
      completion: "outcome_unknown",
    },
  ];
  for (const sessionRef of [
    "urn:composio:one-use-proof",
    "https://session.example.test/short-proof",
  ])
    for (const expected of cases) {
      const encoded = encodeURIComponent(sessionRef);
      const { provider, calls } = fixture([
        Response.json(
          {
            error: {
              message: `Identity protocol diagnostic: ${sessionRef}; encoded=${encoded}`,
            },
          },
          { status: expected.status },
        ),
      ]);
      await assert.rejects(
        provider.completeIdentity(
          { sessionRef, subjectId: binding.subjectId },
          signal(),
        ),
        (error: unknown) => {
          assert.ok(error instanceof ConnectorProviderError);
          assert.equal(error.code, expected.code);
          assert.equal(error.completion, expected.completion);
          assert.ok(!error.message.includes(sessionRef));
          assert.ok(!error.message.includes(encoded));
          assert.doesNotMatch(error.message, /Identity protocol diagnostic/);
          return true;
        },
      );
      assert.equal(calls.length, 1);
    }
});

await test("failed or expired identity redemption is never repeated or tried with another subject", async () => {
  for (const status of [400, 404]) {
    const { provider, calls } = fixture([
      Response.json(
        { error: { message: "Verification rejected." } },
        { status },
      ),
    ]);
    await assert.rejects(
      provider.completeIdentity(
        { sessionRef: "one-use-session", subjectId: binding.subjectId },
        signal(),
      ),
      (error: unknown) =>
        error instanceof ConnectorProviderError &&
        error.code === "connector_provider_rejected" &&
        error.completion === "rejected",
    );
    assert.equal(calls.length, 1);
  }
  const { provider, calls } = fixture([
    new TypeError("Response lost after session redemption"),
  ]);
  await assert.rejects(
    provider.completeIdentity(
      { sessionRef: "one-use-session", subjectId: binding.subjectId },
      signal(),
    ),
    (error: unknown) =>
      error instanceof ConnectorProviderError &&
      error.completion === "outcome_unknown" &&
      error.retry.strategy === "reconcile",
  );
  assert.equal(calls.length, 1);
});

await test("malformed account disablement cannot be interpreted as active", async () => {
  const { provider } = fixture([
    Response.json(account({ is_disabled: "true" })),
  ]);
  await assert.rejects(
    provider.inspectAccount(binding, signal()),
    (error: unknown) =>
      error instanceof ConnectorProviderError &&
      error.code === "connector_provider_invalid_response",
  );
});
