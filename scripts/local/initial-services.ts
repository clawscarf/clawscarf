import { browserDefaults } from "./browser.js";
import { executionDefaults } from "./execution.js";
import type { withInitialModels } from "./models.js";

/** Compose a fresh native preset. Existing native state is never reconciled through this helper. */
export function withInitialServices(
  native: ReturnType<typeof withInitialModels>,
  services: { execution: boolean; browserToken?: string },
) {
  const browser =
    services.browserToken === undefined
      ? undefined
      : browserDefaults(services.browserToken);
  return {
    ...native,
    ...(browser ? { browser: { ...native.browser, ...browser } } : {}),
    ...(browser && services.execution
      ? {
          tools: {
            ...native.tools,
            sandbox: { tools: { alsoAllow: ["browser"] } },
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
