/** Machine grants never confer human organization or installation administration. */
export const CONNECTOR_RUNTIME_PERMISSIONS = [
  "connector-runtime:search",
  "connector-runtime:describe",
  "connector-runtime:call",
  "connector-runtime:receipt",
] as const;

export interface ConnectorRuntimePrincipal {
  credentialId: string;
  credentialGeneration: number;
  serverId: string;
}
