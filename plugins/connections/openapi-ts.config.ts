import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./openapi/broker.yaml",
  output: {
    path: "generated",
    module: {
      resolve: (path) =>
        path === "@hey-api/client-fetch" ? "./http/client/index.js" : undefined,
    },
  },
  plugins: [
    "@hey-api/typescript",
    { name: "@hey-api/client-fetch", bundle: false },
    "@hey-api/sdk",
  ],
});
