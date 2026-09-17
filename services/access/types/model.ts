export interface Identity {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
}
export interface User {
  id: string;
  identity: string;
  email: string;
  name: string;
}
export interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  setupTokenHash?: string | undefined;
  invitationTokenHash?: string | undefined;
}
export interface Session {
  hash: string;
  user: User;
  csrfToken: string;
}
export interface LoginProvider {
  authorization(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    reauthenticate?: boolean;
  }): Promise<string>;
  exchange(input: {
    callbackUrl: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<{ identity: Identity; logoutUrl: string | null }>;
}
export interface Invitation {
  id: string;
  email: string;
  expiresAt: string;
  status: "pending" | "accepted" | "revoked" | "expired";
}
export interface AccessStore {
  invitations(): Promise<Invitation[]>;
  createInvitation(
    sponsorId: string,
    email: string,
    tokenHash: string,
  ): Promise<Invitation>;
  revokeInvitation(id: string): Promise<void>;
  bindInvitation(
    tokenHash: string,
    identity: Identity,
    credentialHash: string,
  ): Promise<Session>;
  finishInvitation(
    tokenHash: string,
    userId: string,
    sessionHash: string,
    csrf: string,
    logoutUrl: string | null,
  ): Promise<void>;
  withEnrollmentLock<T>(work: (store: AccessStore) => Promise<T>): Promise<T>;
  people(): Promise<User[]>;
  eligibleIdentities(): Promise<string[]>;
  person(id: string): Promise<User | null>;
  initialize(): Promise<{ serverId: string; administrator: User }>;
  beginLogin(cookieHash: string, transaction: LoginTransaction): Promise<void>;
  consumeLogin(
    cookieHash: string,
    state: string,
  ): Promise<LoginTransaction | null>;
  admitIdentity(identity: Identity): Promise<User>;
  createSession(
    userId: string,
    hash: string,
    csrfToken: string,
    logoutUrl: string | null,
  ): Promise<void>;
  authenticateSession(hash: string): Promise<Session | null>;
  revokeSession(hash: string): Promise<string | null>;
  createDelegation(parentHash: string, hash: string): Promise<void>;
  revokeDelegation(hash: string): Promise<void>;
  createEnrollmentDelegation(
    parentHash: string,
    userId: string,
    hash: string,
  ): Promise<void>;
  prepareEnrollment(identity: Identity): Promise<User>;
  activateEnrollment(id: string): Promise<void>;
  removeEnrollment(id: string): Promise<void>;
  createLocalToken(hash: string): Promise<void>;
  createLocalSession(
    tokenHash: string,
    sessionHash: string,
    csrfToken: string,
  ): Promise<boolean>;
  administratorSetup(): Promise<{
    complete: boolean;
    expiresAt: string | null;
  }>;
  beginAdministratorSetup(hash: string): Promise<void>;
  bindAdministrator(
    hash: string,
    identity: Identity,
    sessionHash: string,
  ): Promise<User>;
  finishAdministratorSetup(
    hash: string,
    userId: string,
    sessionHash: string,
    csrfToken: string,
    logoutUrl: string | null,
  ): Promise<void>;
}
