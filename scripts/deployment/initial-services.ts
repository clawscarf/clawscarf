import { browserDefaults } from "./browser.js";
import { executionDefaults } from "./execution.js";
import type { withInitialModels } from "./models.js";

/** Compose a fresh native preset. Existing native state is never reconciled through this helper. */
export function withInitialServices(
  native: ReturnType<typeof withInitialModels>,
  services: {
    execution: boolean;
    browserToken?: string;
    browserNode?: string;
    connectionsBrokerUrl?: string;
  },
) {
  const browser =
    services.browserToken === undefined
      ? undefined
      : browserDefaults(services.browserToken);
  return {
    ...native,
    ...(services.connectionsBrokerUrl
      ? {
          secrets: {
            ...("secrets" in native ? native.secrets : {}),
            providers: {
              ...("secrets" in native ? native.secrets.providers : {}),
              "clawscarf-connections": {
                source: "env",
                allowlist: ["CLAWSCARF_CONNECTIONS_TOKEN"],
              },
            },
          },
          plugins: {
            ...native.plugins,
            entries: {
              ...native.plugins.entries,
              "clawscarf-connections": {
                enabled: true,
                config: {
                  brokerUrl: services.connectionsBrokerUrl,
                  credential: {
                    source: "env",
                    provider: "clawscarf-connections",
                    id: "CLAWSCARF_CONNECTIONS_TOKEN",
                  },
                },
              },
            },
          },
        }
      : {}),
    ...(browser && services.browserNode
      ? {
          gateway: {
            ...native.gateway,
            nodes: {
              pairing: { autoApproveLocal: false },
              browser: { mode: "manual", node: services.browserNode },
            },
          },
        }
      : {}),
    ...(browser ? { browser: { ...native.browser, ...browser } } : {}),
    ...((browser && services.execution) || services.connectionsBrokerUrl
      ? {
          tools: {
            ...native.tools,
            sandbox: {
              tools: {
                alsoAllow: [
                  ...(browser && services.execution ? ["browser"] : []),
                  ...(services.connectionsBrokerUrl
                    ? [
                        "connections_search",
                        "connections_describe",
                        "connections_call",
                      ]
                    : []),
                ],
              },
            },
          },
        }
      : {}),
    ...(services.execution
      ? {
          agents: {
            ...("agents" in native ? native.agents : {}),
            defaults: {
              ...("agents" in native ? native.agents.defaults : {}),
              sandbox: {
                ...executionDefaults(),
                ...(browser
                  ? { browser: { enabled: false, allowHostControl: true } }
                  : {}),
              },
            },
          },
        }
      : {}),
  };
}
