import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "services/connections/openapi.json",
  output: {
    path: "services/connections/generated/server",
    postProcess: ["prettier"],
  },
  plugins: ["@hey-api/typescript", "fastify"],
});
