import type { AgentToolResult } from "openclaw/plugin-sdk/tool-results";
import { ConnectorFailure } from "./broker.ts";
import type {
  ConnectorRuntimeInvocation,
  ConnectorRuntimeDescription,
  ConnectorRuntimeResultPage,
  ConnectorRuntimeSearchResult,
} from "./generated/types.gen.js";

export const MAX_TOOL_RESULT_BYTES = 64 * 1024;
export const MAX_TOOL_DESCRIPTION_BYTES = 128 * 1024;
export const MAX_TOOL_ARGUMENT_BYTES = 128 * 1024;
export const MAX_TOOL_REQUEST_BYTES = 256 * 1024;

/** Preserve JSON values exactly; never coerce an unsupported value or truncate a result. */
export function boundedJson(value: unknown, maximumBytes: number): string {
  const encoded = JSON.stringify(value, (_key, item: unknown) => {
    if (
      typeof item === "bigint" ||
      typeof item === "function" ||
      typeof item === "symbol" ||
      typeof item === "undefined" ||
      (typeof item === "number" && !Number.isFinite(item))
    ) {
      throw new ConnectorFailure(
        "invalid_result",
        "The connection returned invalid JSON.",
      );
    }
    return item;
  });
  if (typeof encoded !== "string") {
    throw new ConnectorFailure(
      "invalid_result",
      "The connection returned invalid JSON.",
    );
  }
  if (Buffer.byteLength(encoded, "utf8") > maximumBytes) {
    throw new ConnectorFailure(
      "result_too_large",
      "The connection result exceeds the supported size.",
    );
  }
  return encoded;
}

export function successResult(
  data: unknown,
  maximumBytes = MAX_TOOL_RESULT_BYTES,
): AgentToolResult<unknown> {
  const details = { ok: true, data };
  return {
    content: [{ type: "text", text: boundedJson(details, maximumBytes) }],
    details,
  };
}

export function descriptionResult(
  value: ConnectorRuntimeDescription,
): AgentToolResult<unknown> {
  return successResult(value, MAX_TOOL_DESCRIPTION_BYTES);
}

export function failureResult(
  error: ConnectorFailure,
  recovery?: { mode: "lookup"; toolCallId: string },
): AgentToolResult<unknown> {
  const details = {
    ok: false,
    error: { code: error.code, message: error.message },
    ...(recovery ? { recovery } : {}),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(details) }],
    details,
  };
}

export function searchResult(
  value: ConnectorRuntimeSearchResult,
): AgentToolResult<unknown> {
  if (value.guidance)
    return successResult({
      ...value,
      message:
        "No connections are available to this agent. An installation administrator can connect an account or grant access on the Connections page.",
    });
  if (!value.items.length)
    return successResult({
      ...value,
      message:
        "No operations matched this search. Try a different search or remove filters.",
    });
  return successResult(value);
}

/** Result delivery failure cannot rewrite an authoritative invocation outcome. */
export function invocationResult(
  value: ConnectorRuntimeInvocation | ConnectorRuntimeResultPage,
): AgentToolResult<unknown> {
  const details = { ok: value.invocation.state === "succeeded", ...value };
  try {
    return {
      content: [
        { type: "text", text: boundedJson(details, MAX_TOOL_RESULT_BYTES) },
      ],
      details,
    };
  } catch (error: unknown) {
    const unavailable = {
      ok: details.ok,
      invocation: value.invocation,
      result: {
        kind: "unavailable",
        reason:
          error instanceof ConnectorFailure && error.code === "result_too_large"
            ? "too_large"
            : "invalid_result",
      },
      message:
        "The complete result could not be delivered. Use result mode with the invocation reference to read saved data; do not execute the operation again.",
    };
    return {
      content: [
        { type: "text", text: boundedJson(unavailable, MAX_TOOL_RESULT_BYTES) },
      ],
      details: unavailable,
    };
  }
}
