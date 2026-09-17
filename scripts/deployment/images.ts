import components from "../../release/components.json" with { type: "json" };

export const liteLlmImage =
  "ghcr.io/berriai/litellm:v1.100.1@sha256:a3715fa7ad8387941ab697259bd2881d68931657247a41984f90fae6d11c62bf";

export const postgresImage =
  "postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";

export const openshellGatewayImage = components.openshell.gatewayImage;
