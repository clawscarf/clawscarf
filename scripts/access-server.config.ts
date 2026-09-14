import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "services/access/openapi.json",
  output: {
    path: "services/access/generated/server",
    postProcess: ["prettier"],
  },
  plugins: ["@hey-api/typescript", "fastify"],
});
