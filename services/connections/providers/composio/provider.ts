import type { ConnectorAuth } from "../../types/catalog.js";
import {
  ConnectorProviderError,
  type ConnectorProvider,
  type ConnectorProviderBinding,
  type ConnectorProviderExecution,
} from "../../types/provider.js";
import { ComposioHttp, type ComposioHttpOptions } from "./http.js";
import {
  array,
  assertBinding,
  invalidResponse,
  jsonValue,
  optionalText,
  readAccount,
  readAuthConfiguration,
  record,
  requireBinding,
  requireHttps,
  requireInputText,
  text,
} from "./wire.js";

export function createComposioProvider(
  options: ComposioHttpOptions,
): ConnectorProvider {
  return new ComposioProvider(new ComposioHttp(options));
}

class ComposioProvider implements ConnectorProvider {
  constructor(private readonly http: ComposioHttp) {}

  async resolveAuthConfiguration(
    input: { toolkit: string; auth: ConnectorAuth },
    signal: AbortSignal,
  ): Promise<{ id: string; toolkit: string; auth: ConnectorAuth }> {
    requireInputText(input.toolkit);
    if (input.auth.kind === "custom") requireInputText(input.auth.scheme, 100);
    const existing = (await this.#authConfigurations(input, signal))
      .filter((candidate) => candidate.enabled && matchesAuth(candidate, input))
      .sort((left, right) => left.id.localeCompare(right.id))[0];
    if (existing)
      return {
        id: existing.id,
        toolkit: existing.toolkit,
        auth: existing.auth,
      };
    const response = await this.http.request({
      method: "POST",
      path: "/api/v3.1/auth_configs",
      signal,
      body: {
        toolkit: { slug: input.toolkit },
        ...(input.auth.kind === "managed"
          ? {}
          : {
              auth_config: {
                type: "use_custom_auth",
                authScheme: input.auth.scheme,
                credentials: {},
              },
            }),
      },
    });
    if (response.missing) throw invalidResponse("outcome_unknown");
    const body = record(response.data, "outcome_unknown");
    const created = readAuthConfiguration(
      body.auth_config,
      "outcome_unknown",
      body.toolkit,
    );
    if (!matchesAuth(created, input)) throw invalidResponse("outcome_unknown");
    // Creation omits status; verify its current enabled state instead of inventing it.
    let configurations: ReturnType<typeof readAuthConfiguration>[];
    try {
      configurations = await this.#authConfigurations(input, signal);
    } catch (error) {
      if (!(error instanceof ConnectorProviderError)) throw error;
      throw new ConnectorProviderError(
        error.code,
        error.message,
        "outcome_unknown",
      );
    }
    const verified = configurations.find(
      (candidate) => candidate.id === created.id,
    );
    if (!verified || !verified.enabled || !matchesAuth(verified, input))
      throw invalidResponse("outcome_unknown");
    return { id: verified.id, toolkit: verified.toolkit, auth: verified.auth };
  }

  async createSetup(
    input: Parameters<ConnectorProvider["createSetup"]>[0],
    signal: AbortSignal,
  ): ReturnType<ConnectorProvider["createSetup"]> {
    requireInputText(input.authConfigurationId);
    requireInputText(input.subjectId);
    try {
      requireHttps(input.callbackUrl, "not_started");
    } catch {
      throw new ConnectorProviderError(
        "connector_provider_request_invalid",
        "Connection callback must use HTTPS.",
        "not_started",
      );
    }
    const response = await this.http.request({
      method: "POST",
      path: "/api/v3.1/connected_accounts/link",
      signal,
      body: {
        auth_config_id: input.authConfigurationId,
        user_id: input.subjectId,
        callback_url: input.callbackUrl,
      },
    });
    if (response.missing) throw invalidResponse("outcome_unknown");
    const body = record(response.data, "outcome_unknown");
    const expiresAt = text(body.expires_at, "outcome_unknown");
    if (!Number.isFinite(Date.parse(expiresAt)))
      throw invalidResponse("outcome_unknown");
    return {
      accountId: text(body.connected_account_id, "outcome_unknown"),
      connectUrl: requireHttps(
        text(body.redirect_url, "outcome_unknown", 16_384),
        "outcome_unknown",
      ),
      expiresAt,
    };
  }

  async completeIdentity(
    input: Parameters<ConnectorProvider["completeIdentity"]>[0],
    signal: AbortSignal,
  ): ReturnType<ConnectorProvider["completeIdentity"]> {
    requireInputText(input.subjectId);
    requireInputText(input.sessionRef, 16_384);
    const response = await this.http.request({
      method: "POST",
      path: "/api/v3.1/connected_accounts/complete_auth",
      diagnostics: "omit",
      signal,
      body: { session_uri: input.sessionRef, user_id: input.subjectId },
    });
    if (response.missing) throw invalidResponse("outcome_unknown");
    const body = record(response.data, "outcome_unknown");
    return {
      accountId: text(body.connected_account_id, "outcome_unknown"),
      toolkit: text(body.toolkit_slug, "outcome_unknown"),
    };
  }

  async inspectAccount(
    binding: ConnectorProviderBinding,
    signal: AbortSignal,
  ): ReturnType<ConnectorProvider["inspectAccount"]> {
    requireBinding(binding);
    const response = await this.http.request({
      method: "GET",
      path: `/api/v3.1/connected_accounts/${encodeURIComponent(binding.accountId)}`,
      missing: true,
      signal,
    });
    if (response.missing) return null;
    const account = readAccount(response.data);
    assertBinding(account.binding, binding);
    return account;
  }

  async deleteAccount(
    binding: ConnectorProviderBinding,
    signal: AbortSignal,
  ): ReturnType<ConnectorProvider["deleteAccount"]> {
    if (!(await this.inspectAccount(binding, signal)))
      return { status: "absent", revocationJobId: null };
    const response = await this.http.request({
      method: "DELETE",
      path: `/api/v3.1/connected_accounts/${encodeURIComponent(binding.accountId)}?revoke_on_delete=true`,
      missing: true,
      signal,
    });
    if (response.missing) return { status: "absent", revocationJobId: null };
    const body = record(response.data, "outcome_unknown");
    if (body.success !== true) throw invalidResponse("outcome_unknown");
    return {
      status: "deleted",
      revocationJobId: optionalText(body.revoke_job_id, "outcome_unknown"),
    };
  }

  async execute(
    input: Parameters<ConnectorProvider["execute"]>[0],
    signal: AbortSignal,
  ): Promise<ConnectorProviderExecution> {
    try {
      requireBinding(input.binding);
      requireInputText(input.actionId, 256);
      requireInputText(input.version, 200);
      if (input.version === "latest")
        throw new ConnectorProviderError(
          "connector_provider_request_invalid",
          "Select the catalog's exact action version.",
          "not_started",
        );
      const argumentsValue = record(
        jsonValue(input.arguments, "not_started"),
        "not_started",
      );
      const response = await this.http.request({
        method: "POST",
        path: `/api/v3.1/tools/execute/${encodeURIComponent(input.actionId)}`,
        signal,
        body: {
          connected_account_id: input.binding.accountId,
          user_id: input.binding.subjectId,
          version: input.version,
          arguments: argumentsValue,
        },
      });
      if (response.missing) throw invalidResponse("outcome_unknown");
      const body = record(response.data, "outcome_unknown");
      if (typeof body.successful !== "boolean")
        throw invalidResponse("outcome_unknown");
      if (!body.successful) {
        const diagnostic = this.http.diagnostic(body.error);
        throw new ConnectorProviderError(
          "connector_provider_rejected",
          diagnostic
            ? `The external service rejected the operation. ${diagnostic}`
            : "The external service rejected the operation.",
          "rejected",
        );
      }
      try {
        return {
          status: "succeeded",
          result: {
            kind: "inline",
            data: jsonValue(body.data, "outcome_unknown"),
          },
        };
      } catch (error) {
        if (!(error instanceof ConnectorProviderError)) throw error;
        return {
          status: "succeeded",
          result: { kind: "unavailable", reason: "invalid_result" },
        };
      }
    } catch (error) {
      if (!(error instanceof ConnectorProviderError)) throw error;
      return {
        status:
          error.completion === "outcome_unknown"
            ? "outcome_unknown"
            : "rejected",
        failure: error.failure(),
      };
    }
  }

  async #authConfigurations(
    input: { toolkit: string; auth: ConnectorAuth },
    signal: AbortSignal,
  ): Promise<ReturnType<typeof readAuthConfiguration>[]> {
    const values: ReturnType<typeof readAuthConfiguration>[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({
        toolkit_slug: input.toolkit,
        is_composio_managed: input.auth.kind === "managed" ? "true" : "false",
        limit: "50",
      });
      if (cursor) query.set("cursor", cursor);
      const response = await this.http.request({
        method: "GET",
        path: `/api/v3.1/auth_configs?${query.toString()}`,
        signal,
      });
      if (response.missing) throw invalidResponse("not_started");
      const body = record(response.data, "not_started");
      values.push(
        ...array(body.items, "not_started").map((value) =>
          readAuthConfiguration(value, "not_started"),
        ),
      );
      cursor = optionalText(body.next_cursor, "not_started");
      if (
        values.length > 50_000 ||
        (cursor && (seen.has(cursor) || seen.size >= 1000))
      )
        throw invalidResponse("not_started");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return values;
  }
}

function matchesAuth(
  candidate: { toolkit: string; auth: ConnectorAuth },
  input: { toolkit: string; auth: ConnectorAuth },
): boolean {
  return (
    candidate.toolkit === input.toolkit &&
    candidate.auth.kind === input.auth.kind &&
    (input.auth.kind !== "custom" ||
      (candidate.auth.kind === "custom" &&
        candidate.auth.scheme === input.auth.scheme))
  );
}
