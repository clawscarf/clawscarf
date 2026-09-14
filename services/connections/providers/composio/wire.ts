import type { ConnectorAuth, ConnectorJson } from "../../types/catalog.js";
import {
  ConnectorProviderError,
  type ConnectorProviderAccount,
  type ConnectorProviderBinding,
  type ConnectorProviderCompletion,
} from "../../types/provider.js";

export function record(
  value: unknown,
  completion: ConnectorProviderCompletion,
): Record<string, unknown> {
  if (!isRecord(value)) throw invalidResponse(completion);
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function text(
  value: unknown,
  completion: ConnectorProviderCompletion,
  maximum = 4096,
): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    Buffer.byteLength(value) > maximum
  )
    throw invalidResponse(completion);
  return value;
}
export function optionalText(
  value: unknown,
  completion: ConnectorProviderCompletion,
  maximum = 4096,
): string | null {
  if (value === null || value === undefined) return null;
  return text(value, completion, maximum);
}
export function array(
  value: unknown,
  completion: ConnectorProviderCompletion,
): unknown[] {
  if (!Array.isArray(value)) throw invalidResponse(completion);
  return value;
}
export function invalidResponse(
  completion: ConnectorProviderCompletion,
): ConnectorProviderError {
  return new ConnectorProviderError(
    "connector_provider_invalid_response",
    "The connection service returned an invalid response.",
    completion,
  );
}

export function readAuthConfiguration(
  value: unknown,
  completion: ConnectorProviderCompletion,
  parentToolkit?: unknown,
): { id: string; toolkit: string; auth: ConnectorAuth; enabled: boolean } {
  const item = record(value, completion);
  const toolkit = record(item.toolkit ?? parentToolkit, completion);
  if (typeof item.is_composio_managed !== "boolean")
    throw invalidResponse(completion);
  return {
    id: text(item.id, completion),
    toolkit: text(toolkit.slug, completion),
    auth: item.is_composio_managed
      ? { kind: "managed" }
      : { kind: "custom", scheme: text(item.auth_scheme, completion) },
    enabled: item.status === "ENABLED",
  };
}

export function readAccount(value: unknown): ConnectorProviderAccount {
  const item = record(value, "not_started");
  const toolkit = record(item.toolkit, "not_started");
  const auth = record(item.auth_config, "not_started");
  for (const value of [item.is_disabled, auth.is_disabled])
    if (value !== undefined && typeof value !== "boolean")
      throw invalidResponse("not_started");
  const disabled = item.is_disabled === true || auth.is_disabled === true;
  const status = text(item.status, "not_started");
  let state: ConnectorProviderAccount["state"];
  switch (status) {
    case "ACTIVE":
      state = disabled ? "reconnect_required" : "active";
      break;
    case "INITIATED":
    case "INITIALIZING":
      state = "pending";
      break;
    case "INACTIVE":
    case "EXPIRED":
    case "REVOKED":
      state = "reconnect_required";
      break;
    case "FAILED":
      state = "failed";
      break;
    default:
      throw invalidResponse("not_started");
  }
  return {
    binding: {
      accountId: text(item.id, "not_started"),
      toolkit: text(toolkit.slug, "not_started"),
      authConfigurationId: text(auth.id, "not_started"),
      subjectId: text(item.user_id, "not_started"),
    },
    label: optionalText(item.alias, "not_started", 300),
    state,
  };
}

export function assertBinding(
  actual: ConnectorProviderBinding,
  expected: ConnectorProviderBinding,
): void {
  if (
    actual.accountId !== expected.accountId ||
    actual.subjectId !== expected.subjectId ||
    actual.toolkit !== expected.toolkit ||
    actual.authConfigurationId !== expected.authConfigurationId
  )
    throw new ConnectorProviderError(
      "connector_account_mismatch",
      "This account does not belong to the requested connection.",
      "not_started",
    );
}
export function requireBinding(binding: ConnectorProviderBinding): void {
  for (const value of [
    binding.accountId,
    binding.subjectId,
    binding.toolkit,
    binding.authConfigurationId,
  ])
    requireInputText(value);
}
export function requireInputText(value: string, maximum = 4096): void {
  if (!value || value.trim() !== value || Buffer.byteLength(value) > maximum)
    throw new ConnectorProviderError(
      "connector_provider_request_invalid",
      "Connection identity or configuration is invalid.",
      "not_started",
    );
}
export function requireHttps(
  value: string,
  completion: ConnectorProviderCompletion,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidResponse(completion);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    value.length > 16_384
  )
    throw invalidResponse(completion);
  return value;
}

export function jsonValue(
  value: unknown,
  completion: ConnectorProviderCompletion,
): ConnectorJson {
  let nodes = 250_000;
  const visit = (node: unknown, depth: number): ConnectorJson => {
    if (--nodes < 0 || depth > 80) throw invalidResponse(completion);
    if (
      node === null ||
      typeof node === "string" ||
      typeof node === "boolean" ||
      (typeof node === "number" && Number.isFinite(node))
    )
      return node;
    if (Array.isArray(node))
      return node.map((child: unknown) => visit(child, depth + 1));
    if (isRecord(node))
      return Object.fromEntries(
        Object.entries(node).map(([key, child]) => [
          key,
          visit(child, depth + 1),
        ]),
      );
    throw invalidResponse(completion);
  };
  return visit(value, 0);
}
