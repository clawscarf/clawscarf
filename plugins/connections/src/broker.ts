import type {
  CallParameters,
  ConnectorConfig,
  DescribeParameters,
  SearchParameters,
} from "./schemas.ts";
import type {
  ConnectorRuntimeDescription,
  ConnectorRuntimeInvocation,
  ConnectorRuntimeResultPage,
  ConnectorRuntimeSearchResult,
} from "./generated/types.gen.js";

/** Native correlation is not proof of a person or a globally unique receipt ID. */
export interface NativeCallContext {
  agentId: string;
  toolCallId: string;
  sessionId?: string;
  sessionKey?: string;
  signal?: AbortSignal;
}

/** The generated REST adapter supplies this capability; no provider key is exposed. */
export interface ConnectorBroker {
  search(
    parameters: SearchParameters,
    context: NativeCallContext,
  ): Promise<ConnectorRuntimeSearchResult>;
  describe(
    parameters: DescribeParameters,
    context: NativeCallContext,
  ): Promise<ConnectorRuntimeDescription>;
  call(
    parameters: CallParameters,
    context: NativeCallContext,
  ): Promise<ConnectorRuntimeInvocation | ConnectorRuntimeResultPage>;
}

export type ConnectorBrokerFactory = (
  config: ConnectorConfig,
) => ConnectorBroker;

export type ConnectorFailureCode =
  | "broker_unavailable"
  | "access_denied"
  | "request_rejected"
  | "receipt_not_found"
  | "rate_limited"
  | "quota_exhausted"
  | "service_disabled"
  | "native_context_unavailable"
  | "invalid_arguments"
  | "invalid_result"
  | "result_too_large"
  | "cancelled"
  | "unknown_outcome";

export class ConnectorFailure extends Error {
  readonly code: ConnectorFailureCode;
  constructor(code: ConnectorFailureCode, message: string) {
    super(message);
    this.name = "ConnectorFailure";
    this.code = code;
  }
}

/** The package stays loadable before the generated broker adapter is configured. */
export function unavailableBroker(): ConnectorBroker {
  const unavailable = (): Promise<never> =>
    Promise.reject(
      new ConnectorFailure(
        "broker_unavailable",
        "Connections are unavailable. Open the installation's Connections page.",
      ),
    );
  return { search: unavailable, describe: unavailable, call: unavailable };
}
