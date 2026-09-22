import { ActivationTelemetry } from "./telemetry.js";
import { defineFeatureContract } from "openclaw/plugin-sdk/feature-contract";
import { defineFeaturePlugin } from "openclaw/plugin-sdk/feature-plugin";
const plugin: ReturnType<typeof defineFeaturePlugin> = defineFeaturePlugin({
  contract: defineFeatureContract({
    pluginId: "clawscarf-access",
    operations: {},
    events: {},
  }),
  name: "ClawScarf People",
  description: "Account, team invitations and native role assignments.",
  setup: (api) => {
    const environment = () => ({ ...api.config.env?.vars, ...process.env });
    if (
      !environment().CLAWSCARF_TELEMETRY_INSTALLATION_ID ||
      environment().CLAWSCARF_TELEMETRY_DISABLED === "1"
    )
      return {};
    const telemetry = new ActivationTelemetry(
      environment,
      api.runtime.state.resolveStateDir(),
    );
    api.on("llm_output", (event, context) =>
      telemetry.response(event, context),
    );
    api.on("agent_end", (event, context) =>
      telemetry.finished({
        success: event.success,
        runId: event.runId ?? context.runId,
      }),
    );
    return {};
  },
});

export default plugin;
