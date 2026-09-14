/** Authenticated local access session, supplied by the access companion at composition. */
export interface Principal {
  user: { id: string };
  sessionHash: string;
}
export interface ActorReference {
  userId: string;
  sessionHash: string;
}
export interface ConnectorServerScope {
  serverId: string;
}
export type ConnectorManagementPermission =
  | "installation-connections:read"
  | "installation-connections:write"
  | "installation-connection-invocations:read";
export type ConnectorSetupPermission = Extract<
  ConnectorManagementPermission,
  "installation-connections:read" | "installation-connections:write"
>;
export interface ConnectorSetupAdmission extends ConnectorServerScope {
  userId: string;
  sessionHash: string;
}
export interface ConnectorAdministratorProof extends ConnectorSetupAdmission {
  verifiedAt: string;
  agentIds: string[];
}
export interface ConnectorAdministratorVerifier {
  verify(
    actor: Principal,
    scope: ConnectorServerScope,
  ): Promise<ConnectorAdministratorProof>;
}
/** Current native authority and revocable access sessions; no copied role database. */
export interface ConnectorIdentity {
  resolveSessionHash(
    hash: string,
  ): Promise<{ hash: string; user: { id: string } } | null>;
  verifyAdministrator(
    sessionHash: string,
  ): Promise<{ userId: string; agentIds: string[] }>;
}
export interface ConnectorServerAuthority {
  resolveActor(reference: ActorReference): Promise<Principal | null>;
  authorize(
    actor: Principal,
    scope: ConnectorServerScope,
    permission: ConnectorManagementPermission,
    proof: ConnectorAdministratorProof,
  ): Promise<void>;
  lock(scope: ConnectorServerScope): Promise<void>;
  setupEligible(
    scope: ConnectorServerScope,
    userId: string,
    sessionHash: string,
  ): Promise<boolean>;
  runtime(scope: ConnectorServerScope): Promise<void>;
}
