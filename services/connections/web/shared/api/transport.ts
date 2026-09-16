import { createClient } from "../../../../../generated/http/client/index.js";
import type { Problem, RetryGuidance } from "../../../generated/types.gen.js";

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
  }
}
export function apiOrigin(value: string): URL {
  const base = new URL(value),
    local = ["127.0.0.1", "[::1]", "localhost"].includes(base.hostname);
  if (
    (base.protocol !== "https:" && !(base.protocol === "http:" && local)) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  )
    throw Error("API URL must be an HTTPS origin or a local HTTP origin.");
  return base;
}
export function requestSignal(
  signal?: AbortSignal,
  timeoutMs = 15_000,
): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}
export function createApiClient(options: {
  baseUrl: string;
  token?: string;
  csrfToken?: () => string | undefined;
  fetch?: typeof fetch;
}) {
  const origin = apiOrigin(options.baseUrl).origin;
  const client = createClient({
    baseUrl: origin,
    credentials: options.token ? "omit" : "same-origin",
    redirect: "error",
    ...(options.token ? { auth: options.token } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  client.interceptors.request.use((request, requestOptions) => {
    if (new URL(request.url).origin !== origin)
      throw new ApiError({
        type: "about:blank",
        title: "Invalid API origin",
        status: 400,
        code: "invalid_api_origin",
        detail: "API requests must stay on the configured origin.",
        retry: { strategy: "never" },
      });
    const csrf = options.csrfToken?.();
    if (csrf && !["GET", "HEAD"].includes(request.method))
      request.headers.set("X-CSRF-Token", csrf);
    // An explicit caller signal owns cancellation/deadline for longer operations.
    return requestOptions.signal
      ? request
      : new Request(request, {
          signal: AbortSignal.timeout(15000),
        });
  });
  client.interceptors.error.use((error, response) => {
    if (error instanceof ApiError) return error;
    const p =
      error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : {};
    const retry = retryGuidance(p.retry);
    return new ApiError({
      type: "about:blank",
      title: typeof p.title === "string" ? p.title : "Request failed",
      status: response?.status ?? 503,
      code: typeof p.code === "string" ? p.code : "transport_error",
      detail:
        typeof p.detail === "string"
          ? p.detail
          : "The API response could not be obtained. Reconcile mutations before retrying.",
      ...(typeof p.requestId === "string" ? { requestId: p.requestId } : {}),
      ...(retry ? { retry } : {}),
    });
  });
  return client;
}
function retryGuidance(value: unknown): RetryGuidance | undefined {
  if (!value || typeof value !== "object" || !("strategy" in value)) return;
  const strategy = value.strategy;
  if (
    strategy !== "never" &&
    strategy !== "after_delay" &&
    strategy !== "after_change" &&
    strategy !== "reconcile"
  )
    return;
  return {
    strategy,
    ...("afterSeconds" in value &&
    typeof value.afterSeconds === "number" &&
    Number.isSafeInteger(value.afterSeconds) &&
    value.afterSeconds >= 0
      ? { afterSeconds: value.afterSeconds }
      : {}),
  };
}
export async function data<T>(request: Promise<{ data: T }>): Promise<T> {
  return (await request).data;
}
