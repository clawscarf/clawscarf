import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "services/access/openapi.json",
  output: {
    path: "services/access/generated",
    postProcess: ["prettier"],
  },
  plugins: [
    "@hey-api/typescript",
    "@hey-api/client-fetch",
    "@hey-api/sdk",
    "fastify",
  ],
});
