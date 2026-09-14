import { ConnectorProviderError } from "../../types/provider.js";
import { providerDiagnostic } from "./diagnostics.js";

export interface ComposioHttpOptions {
  apiKey: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  maximumJsonBytes?: number;
}

export class ComposioHttp {
  readonly #baseUrl: URL;
  readonly #key: string;
  readonly #fetch: typeof fetch;
  readonly #timeout: number;
  readonly #maximum: number;
  constructor(options: ComposioHttpOptions) {
    this.#baseUrl = new URL(
      options.apiBaseUrl ?? "https://backend.composio.dev",
    );
    if (
      this.#baseUrl.protocol !== "https:" ||
      this.#baseUrl.username ||
      this.#baseUrl.password ||
      this.#baseUrl.search ||
      this.#baseUrl.hash ||
      this.#baseUrl.pathname !== "/"
    )
      throw Error("Connector API base must be a credential-free HTTPS origin.");
    if (!options.apiKey || options.apiKey.trim() !== options.apiKey)
      throw Error("Connector provider credential is missing or invalid.");
    this.#key = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeout = positive(options.requestTimeoutMs ?? 30_000);
    this.#maximum = positive(options.maximumJsonBytes ?? 8 * 1024 * 1024);
  }

  async request(input: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    body?: object;
    missing?: boolean;
    diagnostics?: "preserve" | "omit";
    signal: AbortSignal;
  }): Promise<{ missing: true } | { missing: false; data: unknown }> {
    if (input.signal.aborted)
      throw new ConnectorProviderError(
        "connector_provider_cancelled",
        "Connection request was cancelled before dispatch.",
        "not_started",
      );
    let body: string | undefined;
    try {
      body = input.body === undefined ? undefined : JSON.stringify(input.body);
    } catch {
      throw new ConnectorProviderError(
        "connector_provider_request_invalid",
        "Connection arguments must be JSON.",
        "not_started",
      );
    }
    if (body && Buffer.byteLength(body) > this.#maximum)
      throw new ConnectorProviderError(
        "connector_provider_request_invalid",
        "Connection request exceeds its size limit.",
        "not_started",
      );
    if (!input.path.startsWith("/api/v3.1/"))
      throw new ConnectorProviderError(
        "connector_provider_request_invalid",
        "Connection endpoint is invalid.",
        "not_started",
      );
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(this.#timeout),
    ]);
    let response: Response;
    try {
      response = await this.#fetch(new URL(input.path, this.#baseUrl), {
        method: input.method,
        headers: {
          "x-api-key": this.#key,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body }),
        signal,
        redirect: "error",
      });
    } catch {
      throw transportFailure(input.method);
    }
    if (input.missing && response.status === 404) {
      await response.body?.cancel();
      return { missing: true };
    }
    let data: unknown;
    try {
      data = await readJson(response, this.#maximum);
    } catch {
      if (
        !response.ok &&
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408
      )
        throw httpFailure(response, null, input.method);
      throw transportFailure(input.method);
    }
    if (!response.ok)
      throw httpFailure(
        response,
        input.diagnostics === "omit" ? null : this.diagnostic(data),
        input.method,
      );
    return { missing: false, data };
  }

  diagnostic(value: unknown): string | null {
    return providerDiagnostic(value, [this.#key]);
  }
}

function transportFailure(
  method: "GET" | "POST" | "DELETE",
): ConnectorProviderError {
  return method === "GET"
    ? new ConnectorProviderError(
        "connector_provider_unavailable",
        "The connection service is unavailable.",
        "not_started",
      )
    : new ConnectorProviderError(
        "connector_provider_unknown_outcome",
        "The connection request may have completed. Check its recorded outcome before trying again.",
        "outcome_unknown",
      );
}
function httpFailure(
  response: Response,
  diagnostic: string | null,
  method: "GET" | "POST" | "DELETE",
): ConnectorProviderError {
  if (
    response.status >= 500 ||
    response.status === 408 ||
    response.status < 400
  )
    return transportFailure(method);
  const detail = diagnostic ? ` ${diagnostic}` : "";
  if (response.status === 429) {
    const header = response.headers.get("retry-after");
    const seconds =
      header && /^\d+$/u.test(header) ? Math.min(Number(header), 86_400) : 30;
    return new ConnectorProviderError(
      "connector_provider_rate_limited",
      `The connection service is temporarily rate limited.${detail}`,
      "rejected",
      seconds,
    );
  }
  if (response.status === 401 || response.status === 403)
    return new ConnectorProviderError(
      "connector_provider_authentication",
      `The connection service rejected its authorization.${detail}`,
      "rejected",
    );
  return new ConnectorProviderError(
    "connector_provider_rejected",
    `The external service rejected the request.${detail}`,
    "rejected",
  );
}
async function readJson(response: Response, maximum: number): Promise<unknown> {
  if (response.status === 204) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) throw Error("Missing provider response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maximum) throw Error("Provider response exceeds its limit.");
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel();
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return value;
}
function positive(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw Error("Connector transport limits must be positive integers.");
  return value;
}
