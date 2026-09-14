import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./openapi/broker.yaml",
  output: { path: "generated" },
  plugins: ["@hey-api/typescript", "@hey-api/client-fetch", "@hey-api/sdk"],
});
