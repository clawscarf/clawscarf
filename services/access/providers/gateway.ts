import {
  GatewayClient,
  isGatewayProtocolResponseError,
} from "@openclaw/gateway-client";
import { z } from "zod";
import { NativeFailure } from "../types/native-errors.js";

const detailSchema = z.object({
  reason: z.string().optional(),
  httpStatus: z.number().optional(),
  code: z.string().optional(),
});

/** Only structured SDK rejections establish an authorization failure. */
export function isAccessDenied(error: unknown): boolean {
  if (!isGatewayProtocolResponseError(error)) return false;
  if (error.gatewayCode === "FORBIDDEN") return true;
  const details = detailSchema.safeParse(error.details);
  if (!details.success) return false;
  return (
    (error.gatewayCode === "NOT_PAIRED" &&
      details.data.code === "DEVICE_IDENTITY_REQUIRED") ||
    (details.data.reason === "websocket-upgrade-rejected" &&
      [401, 403].includes(details.data.httpStatus ?? 0)) ||
    ["AUTH_REQUIRED", "AUTH_UNAUTHORIZED", "AUTH_SCOPE_MISMATCH"].includes(
      details.data.code ?? "",
    )
  );
}

export interface NativeGateway {
  read(
    method:
      | "users.self"
      | "users.list"
      | "config.get"
      | "agents.list"
      | "exec.approvals.get",
    input: unknown,
  ): Promise<unknown>;
  mutate(method: string, input: unknown): Promise<unknown>;
  scopes: readonly string[];
}

/** Each Gateway connection has one acting session. */
export async function withGateway<T>(
  options: {
    origin: string;
    endpoint?: string;
    credential: string;
    scopes?: string[];
  },
  work: (gateway: NativeGateway) => Promise<T>,
): Promise<T> {
  const scopes = options.scopes ?? ["operator.admin"];
  const ready = Promise.withResolvers<readonly string[]>();
  let mutationAttempted = false;
  let closing = false;
  const publicUrl = new URL(options.origin);
  const url = new URL(options.endpoint ?? options.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const client = new GatewayClient({
    url: url.href,
    origin: options.origin,
    edgeAuthHeaders: {
      Host: publicUrl.host,
      Cookie: `clawscarf_session=${options.credential}`,
    },
    clientName: "gateway-client",
    clientVersion: "2026.9.4",
    mode: "backend",
    role: "operator",
    minProtocol: 4,
    maxProtocol: 4,
    scopes,
    deviceIdentity: null,
    requestTimeoutMs: 10_000,
    hostDeps: { logDebug() {}, logError() {} },
    onHelloOk: (hello) => ready.resolve(hello.auth?.scopes ?? []),
    onConnectError: (error) => ready.reject(error),
    onClose: () => {
      if (!closing) ready.reject(new NativeFailure("unavailable"));
    },
  });
  const deadline = setTimeout(
    () => ready.reject(new NativeFailure("unavailable")),
    15_000,
  );
  let outcome: { ok: true; value: T } | { ok: false; error: NativeFailure };
  try {
    client.start();
    const granted = await ready.promise;
    clearTimeout(deadline);
    if (scopes.includes("operator.admin")) {
      if (!granted.includes("operator.admin"))
        throw new NativeFailure("access_denied");
      await client.request<unknown>("exec.approvals.get", {});
    }
    outcome = {
      ok: true,
      value: await work({
        scopes: granted,
        read: (method, input) => client.request<unknown>(method, input),
        mutate: (method, input) => {
          mutationAttempted = true;
          return client.request<unknown>(method, input);
        },
      }),
    };
  } catch (error) {
    outcome = {
      ok: false,
      error: new NativeFailure(
        mutationAttempted
          ? "outcome_unknown"
          : error instanceof NativeFailure
            ? error.code
            : isAccessDenied(error)
              ? "access_denied"
              : "unavailable",
      ),
    };
  } finally {
    clearTimeout(deadline);
    closing = true;
  }
  try {
    await client.stopAndWait({ timeoutMs: 2000 });
  } catch {
    if (outcome.ok)
      throw new NativeFailure(
        mutationAttempted ? "outcome_unknown" : "unavailable",
      );
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
