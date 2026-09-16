import {
  GatewayClient,
  GatewayClientRequestError,
  isGatewayProtocolResponseError,
} from "@openclaw/gateway-client";
import { z } from "zod";
import application from "../../../package.json" with { type: "json" };
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
  let completedMutations = 0;
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
    clientVersion: application.version,
    mode: "backend",
    role: "operator",
    minProtocol: 4,
    maxProtocol: 4,
    scopes,
    deviceIdentity: null,
    requestTimeoutMs: 10_000,
    hostDeps: { logDebug() {}, logError() {} },
    onHelloOk: (hello) => ready.resolve(hello.auth?.scopes ?? []),
    onConnectError: (error) => {
      const details =
        error instanceof GatewayClientRequestError
          ? detailSchema.safeParse(error.details)
          : null;
      const denied =
        details?.success &&
        details.data.reason === "websocket-upgrade-rejected" &&
        [401, 403].includes(details.data.httpStatus ?? 0);
      ready.reject(denied ? new NativeFailure("access_denied") : error);
    },
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
        mutate: async (method, input) => {
          mutationAttempted = true;
          try {
            const result = await client.request<unknown>(method, input);
            completedMutations++;
            return result;
          } catch (error) {
            // Only known pre-execution rejections prove that this write was refused.
            // UNAVAILABLE can also mean config persisted but activation failed.
            if (completedMutations > 0)
              throw new NativeFailure("outcome_unknown");
            if (isAccessDenied(error)) throw new NativeFailure("access_denied");
            if (
              isGatewayProtocolResponseError(error) &&
              error.gatewayCode === "INVALID_REQUEST"
            )
              throw new NativeFailure("request_rejected");
            throw new NativeFailure("outcome_unknown");
          }
        },
      }),
    };
  } catch (error) {
    outcome = {
      ok: false,
      error: new NativeFailure(
        completedMutations > 0
          ? "outcome_unknown"
          : error instanceof NativeFailure
            ? error.code
            : mutationAttempted
              ? "outcome_unknown"
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
