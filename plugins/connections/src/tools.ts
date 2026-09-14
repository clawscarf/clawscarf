import type {
  AnyAgentTool,
  OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/plugin-entry";
import type { Static, TSchema } from "typebox";
import type { AgentToolResult } from "openclaw/plugin-sdk/tool-results";
import { Check } from "typebox/value";
import { ConnectorFailure, type NativeCallContext } from "./broker.ts";
import {
  boundedJson,
  failureResult,
  MAX_TOOL_ARGUMENT_BYTES,
  MAX_TOOL_REQUEST_BYTES,
  successResult,
} from "./result.ts";

export function createConnectorTool<
  TParameters extends TSchema,
  TResult,
>(input: {
  name: string;
  description: string;
  parameters: TParameters;
  toolContext: OpenClawPluginToolContext;
  requireSession?: boolean;
  dispatches?(parameters: Static<TParameters>): boolean;
  execute(
    parameters: Static<TParameters>,
    context: NativeCallContext,
  ): Promise<TResult>;
  render?(result: TResult): AgentToolResult<unknown>;
}): AnyAgentTool {
  return {
    name: input.name,
    label: input.name,
    description: input.description,
    parameters: input.parameters,
    async execute(toolCallId, parameters, signal) {
      if (
        !input.toolContext.agentId?.trim() ||
        !toolCallId.trim() ||
        toolCallId.length > 256 ||
        (input.requireSession &&
          !input.toolContext.sessionId?.trim() &&
          !input.toolContext.sessionKey?.trim())
      ) {
        return failureResult(
          new ConnectorFailure(
            "native_context_unavailable",
            "The current agent could not be identified.",
          ),
        );
      }
      if (!Check(input.parameters, parameters)) {
        return failureResult(
          new ConnectorFailure(
            "invalid_arguments",
            "The connection tool arguments are invalid.",
          ),
        );
      }
      try {
        boundedJson(parameters, MAX_TOOL_REQUEST_BYTES);
        if (
          typeof parameters === "object" &&
          parameters !== null &&
          "arguments" in parameters
        )
          boundedJson(parameters.arguments, MAX_TOOL_ARGUMENT_BYTES);
      } catch {
        return failureResult(
          new ConnectorFailure(
            "invalid_arguments",
            "The connection tool arguments must be bounded JSON.",
          ),
        );
      }
      if (signal?.aborted) {
        return failureResult(
          new ConnectorFailure(
            "cancelled",
            "The connection call was cancelled before dispatch.",
          ),
        );
      }
      const context: NativeCallContext = {
        agentId: input.toolContext.agentId,
        toolCallId,
        ...(input.toolContext.sessionId
          ? { sessionId: input.toolContext.sessionId }
          : {}),
        ...(input.toolContext.sessionKey
          ? { sessionKey: input.toolContext.sessionKey }
          : {}),
        ...(signal ? { signal } : {}),
      };
      try {
        const result = await input.execute(parameters, context);
        return input.render ? input.render(result) : successResult(result);
      } catch (error: unknown) {
        const dispatches = input.dispatches?.(parameters) ?? false;
        const failure =
          error instanceof ConnectorFailure
            ? error
            : dispatches
              ? new ConnectorFailure(
                  "unknown_outcome",
                  "The outcome could not be confirmed. Look up this call in the current session; do not repeat the operation.",
                )
              : new ConnectorFailure(
                  "broker_unavailable",
                  "The connection result could not be read. No operation was dispatched by this read.",
                );
        return failureResult(
          failure,
          dispatches && failure.code === "unknown_outcome"
            ? { mode: "lookup", toolCallId }
            : undefined,
        );
      }
    },
  };
}
