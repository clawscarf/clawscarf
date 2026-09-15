import type { IncomingMessage, ServerResponse } from "node:http";

export const chromeOrigin = "http://127.0.0.1:9222";
const maximumDiscoveryBytes = 1024 * 1024;
export interface DiscoveryRequest {
  origin: string;
  shape: "object" | "array";
}

/** Capture the client's authority before httpxy supplies Chromium's loopback Host. */
export function discoveryRequest(
  request: Pick<IncomingMessage, "method" | "url" | "headers">,
): DiscoveryRequest | undefined {
  const path = request.url?.split("?", 1)[0];
  const shape =
    request.method === "GET" && (path === "/json" || path === "/json/list")
      ? "array"
      : (request.method === "GET" && path === "/json/version") ||
          (request.method === "PUT" && path === "/json/new")
        ? "object"
        : undefined;
  if (!shape) return undefined;
  const host = request.headers.host;
  if (!host || host.length > 512 || /[\s/\\?#@]/u.test(host))
    throw Error("Invalid discovery authority.");
  const origin = new URL(`http://${host}`);
  if (origin.username || origin.password || origin.pathname !== "/")
    throw Error("Invalid discovery authority.");
  return { origin: origin.origin, shape };
}

/** Only Chromium's fixed endpoint is translated; native target identity remains unchanged. */
export function rewriteDiscovery(
  value: unknown,
  request: DiscoveryRequest,
): unknown {
  function target(value: unknown, required: boolean) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("Invalid discovery object.");
    if (!("webSocketDebuggerUrl" in value)) {
      if (required) throw Error("Discovery endpoint is missing.");
      return value;
    }
    if (typeof value.webSocketDebuggerUrl !== "string")
      throw Error("Invalid discovery endpoint.");
    const endpoint = new URL(value.webSocketDebuggerUrl);
    if (
      endpoint.protocol !== "ws:" ||
      endpoint.host !== "127.0.0.1:9222" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash ||
      endpoint.search ||
      !/^\/devtools\/[a-z_]+\/[^/]+$/u.test(endpoint.pathname)
    )
      throw Error("Unexpected discovery endpoint.");
    const advertised = new URL(request.origin);
    advertised.protocol = "ws:";
    advertised.pathname = endpoint.pathname;
    return { ...value, webSocketDebuggerUrl: advertised.href };
  }
  if (request.shape === "array") {
    if (!Array.isArray(value)) throw Error("Invalid discovery list.");
    return value.map((item: unknown) => target(item, false));
  }
  return target(value, true);
}

/** httpxy owns the request; this bounded response handler changes only CDP discovery JSON. */
export async function writeDiscoveryResponse(
  upstream: IncomingMessage,
  response: ServerResponse,
  request: DiscoveryRequest,
): Promise<void> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of upstream.iterator({ destroyOnReturn: false })) {
    const value: unknown = chunk;
    if (!Buffer.isBuffer(value)) throw Error("Invalid discovery response.");
    bytes += value.length;
    if (bytes > maximumDiscoveryBytes)
      throw Error("Discovery response is too large.");
    chunks.push(value);
  }
  let body = Buffer.concat(chunks, bytes);
  const status = upstream.statusCode ?? 502;
  if (status === 200) {
    if (
      !upstream.headers["content-type"]?.startsWith("application/json") ||
      (upstream.headers["content-encoding"] !== undefined &&
        upstream.headers["content-encoding"] !== "identity")
    )
      throw Error("Invalid discovery representation.");
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    );
    body = Buffer.from(JSON.stringify(rewriteDiscovery(value, request)));
  }
  response.writeHead(status, {
    "Content-Type": status === 200 ? "application/json" : "text/plain",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  response.end(body);
}
