import { defineFeatureContract } from "openclaw/plugin-sdk/feature-contract";
import { defineFeaturePlugin } from "openclaw/plugin-sdk/feature-plugin";
const plugin: ReturnType<typeof defineFeaturePlugin> = defineFeaturePlugin({
  contract: defineFeatureContract({
    pluginId: "clawscarf-access",
    operations: {},
    events: {},
  }),
  name: "ClawScarf account",
  description: "Open your ClawScarf account or manage team admission.",
  setup: () => ({}),
});

export default plugin;
