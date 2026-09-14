import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { type ConnectorBrokerFactory } from "./broker.ts";
import { createRestBroker } from "./rest-broker.ts";
import { descriptionResult, invocationResult, searchResult } from "./result.ts";
import {
  callParameters,
  configSchema,
  hasConnectionConfiguration,
  describeParameters,
  searchParameters,
} from "./schemas.ts";
import { createConnectorTool } from "./tools.ts";

export function createConnectionsPlugin(createBroker: ConnectorBrokerFactory) {
  return defineToolPlugin({
    id: "clawscarf-connections",
    name: "Connections",
    description: "Use the accounts connected to this installation.",
    configSchema,
    tools: (tool) => [
      tool({
        name: "connections_search",
        description:
          "Find available connections and their operations. Search before choosing an exact connection and method.",
        parameters: searchParameters,
        factory: ({ config, toolContext }) =>
          hasConnectionConfiguration(config)
            ? createConnectorTool({
                name: "connections_search",
                description: "Find available connections and their operations.",
                parameters: searchParameters,
                toolContext,
                execute: (parameters, context) =>
                  createBroker(config).search(parameters, context),
                render: searchResult,
              })
            : null,
      }),
      tool({
        name: "connections_describe",
        description:
          "Describe an operation on an exact connection. Its provider schemas are hints; use returned errors to correct arguments.",
        parameters: describeParameters,
        factory: ({ config, toolContext }) =>
          hasConnectionConfiguration(config)
            ? createConnectorTool({
                name: "connections_describe",
                description:
                  "Describe an operation on an exact connection. Provider schemas are advisory.",
                parameters: describeParameters,
                toolContext,
                execute: (parameters, context) =>
                  createBroker(config).describe(parameters, context),
                render: descriptionResult,
              })
            : null,
      }),
      tool({
        name: "connections_call",
        description:
          "Execute a described connection operation, read a saved result page, or look up an earlier call in this session. Only execute can change external systems. Never execute again to recover an outcome or result.",
        parameters: callParameters,
        factory: ({ config, toolContext }) =>
          hasConnectionConfiguration(config)
            ? createConnectorTool({
                name: "connections_call",
                description:
                  "Execute a described operation, read its saved result, or look up an earlier call without executing it again.",
                parameters: callParameters,
                toolContext,
                requireSession: true,
                dispatches: (parameters) => parameters.mode === "execute",
                execute: (parameters, context) =>
                  createBroker(config).call(parameters, context),
                render: invocationResult,
              })
            : null,
      }),
    ],
  });
}

export default createConnectionsPlugin(createRestBroker);
