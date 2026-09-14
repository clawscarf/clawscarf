import type { Page } from "../shared/pagination.js";
import type {
  ConnectorServerAuthority,
  ConnectorServerScope,
} from "../types/authority.js";
import type {
  ConnectionAccountRecord,
  ConnectionCommand,
  ConnectionCredential,
  ConnectionInvocationRecord,
  ConnectionRecord,
  ConnectionSetupRecord,
} from "./model.js";
import type { ConnectorJson } from "./catalog.js";
import type { ConnectionCallbackStore } from "./callbacks.js";
import type { ConnectionReturnStore } from "./returns.js";
import type { CatalogPublicationStore } from "./catalog-publication.js";

export interface ConnectionStore {
  get(
    scope: ConnectorServerScope,
    id: string,
  ): Promise<ConnectionRecord | null>;
  list(
    scope: ConnectorServerScope,
    limit: number,
    cursor: string | null,
    includeDisconnected: boolean,
  ): Promise<Page<ConnectionRecord>>;
  count(scope: ConnectorServerScope): Promise<number>;
  usable(
    scope: ConnectorServerScope,
    agentId: string,
  ): Promise<ConnectionRecord[]>;
  save(record: ConnectionRecord): Promise<void>;
  command(
    scope: ConnectorServerScope,
    actorId: string,
    key: string,
  ): Promise<ConnectionCommand | null>;
  saveCommand(
    scope: ConnectorServerScope,
    command: ConnectionCommand,
  ): Promise<void>;
}
export interface ConnectionSetupStore {
  /** Worker delivery resolves an opaque job ID before checking its current authority. */
  byId(id: string): Promise<ConnectionSetupRecord | null>;
  get(
    scope: ConnectorServerScope,
    id: string,
  ): Promise<ConnectionSetupRecord | null>;
  latest(
    scope: ConnectorServerScope,
    connectionId: string,
  ): Promise<ConnectionSetupRecord | null>;
  pendingForUser(
    userId: string,
    projectId: string,
  ): Promise<ConnectionSetupRecord[]>;
  save(record: ConnectionSetupRecord): Promise<void>;
  due(limit: number): Promise<ConnectionSetupRecord[]>;
}
export interface ConnectionAccountStore {
  get(
    scope: ConnectorServerScope,
    id: string,
  ): Promise<ConnectionAccountRecord | null>;
  byProvider(
    projectId: string,
    accountId: string,
  ): Promise<ConnectionAccountRecord | null>;
  forConnection(
    scope: ConnectorServerScope,
    connectionId: string,
  ): Promise<ConnectionAccountRecord[]>;
  save(record: ConnectionAccountRecord): Promise<void>;
  due(limit: number): Promise<ConnectionAccountRecord[]>;
}
export interface ConnectionCredentialStore {
  byHash(hash: string): Promise<ConnectionCredential | null>;
  get(
    scope: ConnectorServerScope,
    id: string,
  ): Promise<ConnectionCredential | null>;
  latest(scope: ConnectorServerScope): Promise<ConnectionCredential | null>;
  current(scope: ConnectorServerScope): Promise<ConnectionCredential | null>;
  save(credential: ConnectionCredential): Promise<void>;
  revoke(scope: ConnectorServerScope, exceptId?: string): Promise<void>;
}
export interface ConnectionInvocationStore {
  get(
    scope: ConnectorServerScope,
    id: string,
  ): Promise<ConnectionInvocationRecord | null>;
  byCorrelation(
    scope: ConnectorServerScope,
    correlation: string,
  ): Promise<ConnectionInvocationRecord | null>;
  /** The invocation receipt and any encrypted result pages commit in the same transaction. */
  save(
    record: ConnectionInvocationRecord,
    pages?: readonly string[],
  ): Promise<void>;
  resultPage(
    scope: ConnectorServerScope,
    id: string,
    pageNumber: number,
  ): Promise<string | null>;
  expireDispatches(): Promise<void>;
}
export interface ConnectionTransaction {
  authority: ConnectorServerAuthority;
  connections: ConnectionStore;
  setups: ConnectionSetupStore;
  callbacks: ConnectionCallbackStore;
  returns: ConnectionReturnStore;
  catalogPublication: CatalogPublicationStore;
  accounts: ConnectionAccountStore;
  credentials: ConnectionCredentialStore;
  invocations: ConnectionInvocationStore;
}
export interface ConnectionRepository {
  transaction<T>(
    work: (store: ConnectionTransaction) => Promise<T>,
  ): Promise<T>;
}
export interface ConnectionProtection {
  issueCredential(): { token: string; hash: string };
  hashCredential(token: string): string;
  subject(userId: string): string;
  seal(binding: string, value: ConnectorJson): string;
  open(binding: string, value: string): ConnectorJson;
  fingerprint(binding: string, value: ConnectorJson): string;
}
