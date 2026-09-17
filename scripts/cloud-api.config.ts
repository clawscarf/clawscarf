import { defineConfig } from "@hey-api/openapi-ts";
export default defineConfig({
  input: "scripts/cloud/openapi.json",
  output: {
    path: "scripts/cloud/generated",
    postProcess: ["prettier"],
    module: {
      resolve: (path) =>
        path === "@hey-api/client-fetch"
          ? "../../../generated/http/client/index.js"
          : undefined,
    },
  },
  plugins: [
    "@hey-api/typescript",
    { name: "@hey-api/client-fetch", bundle: false },
    "@hey-api/sdk",
  ],
});
