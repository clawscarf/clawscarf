import type { ConnectorJson } from "./catalog.js";
import type { ActorReference } from "../types/authority.js";
import type {
  ConnectorProviderBinding,
  ConnectorProviderFailure,
} from "./provider.js";
import type { ConnectorServerScope } from "../types/authority.js";
import type { ConnectorRuntimePrincipal } from "./runtime-auth.js";

export type ConnectionGrant =
  { mode: "all" } | { mode: "selected"; agentIds: string[] };
export interface ConnectionRecord extends ConnectorServerScope {
  id: string;
  connectorId: string;
  name: string;
  grant: ConnectionGrant;
  state: "not_connected" | "connected" | "needs_attention" | "disconnected";
  generation: number;
  revision: number;
  activeAccountId: string | null;
  failure: ConnectorProviderFailure | null;
  createdAt: string;
  updatedAt: string;
}
export interface ConnectionSetupRecord extends ConnectorServerScope {
  id: string;
  connectionId: string;
  initiatorId: string;
  actor: ActorReference;
  sessionHash: string;
  subjectId: string;
  projectId: string;
  kind: "initial" | "reconnect";
  state:
    | "creating"
    | "pending"
    | "verifying"
    | "succeeded"
    | "expired"
    | "cancelled"
    | "failed"
    | "outcome_unknown";
  accountId: string | null;
  sealedUrl: string | null;
  allocationDispatchedAt: string | null;
  preparationDispatchedAt: string | null;
  preparationCatalogVersion: string | null;
  preparedAuth: { id: string; toolkit: string } | null;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  failure: ConnectorProviderFailure | null;
}
export interface ConnectionAccountRecord extends ConnectorServerScope {
  id: string;
  connectionId: string;
  setupId: string;
  projectId: string;
  binding: ConnectorProviderBinding;
  state: "candidate" | "active" | "cleanup";
  cleanup: "none" | "pending" | "running" | "complete" | "needs_attention";
  revocationJobId: string | null;
  failure: ConnectorProviderFailure | null;
  nextAttemptAt: string | null;
}
export interface ConnectionCredential extends ConnectorRuntimePrincipal {
  hash: string;
  state: "active" | "revoked";
}
export interface ConnectionCommand {
  key: string;
  actorId: string;
  fingerprint: string;
  resourceId: string;
}
export interface ConnectorCallContext {
  agentId: string;
  toolCallId: string;
  sessionId?: string;
  sessionKey?: string;
}
export interface ConnectionInvocationRecord extends ConnectorServerScope {
  id: string;
  connectionId: string;
  generation: number;
  credentialId: string;
  credentialGeneration: number;
  accountId: string;
  agentId: string;
  correlation: string;
  fingerprint: string;
  actionId: string;
  version: string;
  state: "dispatching" | "succeeded" | "rejected" | "outcome_unknown";
  createdAt: string;
  completedAt: string | null;
  failure: ConnectorProviderFailure | null;
  sealedResult: string | null;
  sealedResultManifest: string | null;
  resultUnavailable:
    | "pending"
    | "failed"
    | "outcome_unknown"
    | "invalid_result"
    | "expired"
    | null;
}
export interface ConnectionResultReference {
  kind: "reference";
  invocationId: string;
  mediaType: "application/json";
  byteLength: number;
  sha256: string;
  expiresAt: string;
}
export interface ConnectionResultUnavailable {
  kind: "unavailable";
  reason:
    "pending" | "failed" | "outcome_unknown" | "invalid_result" | "expired";
}
export type ConnectionInvocationResult =
  | { kind: "inline"; data: ConnectorJson }
  | ConnectionResultReference
  | ConnectionResultUnavailable;
export interface ConnectionResultPage {
  kind: "page";
  reference: ConnectionResultReference;
  text: string;
  offsetBytes: number;
  nextCursor: string | null;
}
