import { brokerEndpoint } from "./endpoint.ts";
import { createClient, createConfig } from "./generated/index.js";
import {
  callConnectorRuntime,
  describeConnectorRuntime,
  getConnectorRuntimeResultPage,
  lookupConnectorRuntimeInvocation,
  searchConnectorRuntime,
} from "./generated/sdk.gen.js";
import {
  ConnectorFailure,
  unavailableBroker,
  type ConnectorBroker,
  type NativeCallContext,
} from "./broker.ts";
import { boundedJson, MAX_TOOL_REQUEST_BYTES } from "./result.ts";
import type { ConnectorConfig } from "./schemas.ts";
import type { ConnectorRuntimeContext } from "./generated/types.gen.js";

function nativeContext(context: NativeCallContext): ConnectorRuntimeContext {
  return {
    agentId: context.agentId,
    toolCallId: context.toolCallId,
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    ...(context.sessionKey ? { sessionKey: context.sessionKey } : {}),
  };
}

function requestBody<T extends object>(
  parameters: T,
  context: NativeCallContext,
) {
  const body = { ...parameters, context: nativeContext(context) };
  try {
    boundedJson(body, MAX_TOOL_REQUEST_BYTES);
  } catch {
    throw new ConnectorFailure(
      "invalid_arguments",
      "The connection request is too large or invalid.",
    );
  }
  return body;
}

function requestSignal(signal?: AbortSignal, timeoutMs = 15_000): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function responseFailure(
  status: number | undefined,
  executing: boolean,
  receipt = false,
): ConnectorFailure {
  if (status === 401 || status === 403)
    return new ConnectorFailure(
      "access_denied",
      "This installation or agent no longer has access to the connection.",
    );
  if (status === 429)
    return new ConnectorFailure(
      "rate_limited",
      "Connections are temporarily rate limited.",
    );
  if (status === 404 && receipt)
    return new ConnectorFailure(
      "receipt_not_found",
      "The requested connection or saved call could not be found. No operation was executed by this read.",
    );
  if (status !== undefined && status >= 400 && status < 500)
    return new ConnectorFailure(
      "request_rejected",
      "The connection request was rejected. Refresh its details before continuing.",
    );
  return executing
    ? new ConnectorFailure(
        "unknown_outcome",
        "The outcome could not be confirmed. Look up this call in the current session; do not repeat the operation.",
      )
    : new ConnectorFailure(
        "broker_unavailable",
        "Connections are unavailable. Open the installation's Connections page.",
      );
}

export function createRestBroker(config: ConnectorConfig): ConnectorBroker {
  if (!config.brokerUrl || typeof config.credential !== "string")
    return unavailableBroker();
  let baseUrl: string;
  try {
    baseUrl = brokerEndpoint(config.brokerUrl);
  } catch {
    return unavailableBroker();
  }
  const client = createClient(
    createConfig({
      baseUrl,
      auth: config.credential,
      redirect: "error",
    }),
  );
  return {
    async search(parameters, context) {
      try {
        const result = await searchConnectorRuntime({
          client,
          body: requestBody(parameters, context),
          signal: requestSignal(context.signal),
        });
        if (!result.data) throw responseFailure(result.response?.status, false);
        return result.data;
      } catch (error: unknown) {
        if (error instanceof ConnectorFailure) throw error;
        throw new ConnectorFailure(
          "broker_unavailable",
          "Connections are unavailable. Open the installation's Connections page.",
        );
      }
    },
    async describe(parameters, context) {
      try {
        const result = await describeConnectorRuntime({
          client,
          body: requestBody(parameters, context),
          signal: requestSignal(context.signal),
        });
        if (!result.data) throw responseFailure(result.response?.status, false);
        return result.data;
      } catch (error: unknown) {
        if (error instanceof ConnectorFailure) throw error;
        throw new ConnectorFailure(
          "broker_unavailable",
          "Connections are unavailable. Open the installation's Connections page.",
        );
      }
    },
    async call(parameters, context) {
      try {
        if (parameters.mode === "result") {
          const result = await getConnectorRuntimeResultPage({
            client,
            path: { invocationId: parameters.invocationId },
            query: {
              agentId: context.agentId,
              ...(parameters.cursor ? { cursor: parameters.cursor } : {}),
            },
            signal: requestSignal(context.signal),
          });
          if (!result.data)
            throw responseFailure(result.response?.status, false, true);
          return result.data;
        }
        if (parameters.mode === "lookup") {
          const result = await lookupConnectorRuntimeInvocation({
            client,
            body: requestBody(
              { targetToolCallId: parameters.toolCallId },
              context,
            ),
            signal: requestSignal(context.signal),
          });
          if (!result.data)
            throw responseFailure(result.response?.status, false, true);
          return result.data;
        }
        const {
          connectionId,
          actionId,
          generation,
          version,
          arguments: args,
        } = parameters;
        const argumentsValue = {
          connectionId,
          actionId,
          generation,
          version,
          arguments: args,
        };
        const result = await callConnectorRuntime({
          client,
          body: requestBody(argumentsValue, context),
          signal: requestSignal(context.signal, 40_000),
        });
        if (!result.data) throw responseFailure(result.response?.status, true);
        return result.data;
      } catch (error: unknown) {
        if (error instanceof ConnectorFailure) throw error;
        throw responseFailure(undefined, parameters.mode === "execute");
      }
    },
  };
}
