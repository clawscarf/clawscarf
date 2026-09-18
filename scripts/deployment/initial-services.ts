import { browserDefaults } from "./browser.js";
import type { withInitialModels } from "./models.js";

/** Compose a fresh native preset. Existing native state is never reconciled through this helper. */
export function withInitialServices(
  native: ReturnType<typeof withInitialModels>,
  services: {
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
  };
}
