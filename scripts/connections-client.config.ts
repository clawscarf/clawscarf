import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "services/connections/openapi.json",
  output: {
    path: "services/connections/generated/client",
    postProcess: ["prettier"],
  },
  plugins: ["@hey-api/typescript", "@hey-api/client-fetch", "@hey-api/sdk"],
});
