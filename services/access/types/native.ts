import type { Session, User } from "./model.js";
/** Management always acts as a current admitted caller, never as the bootstrap owner. */
export interface NativeActor {
  identity: string;
  name?: string;
  sessionHash: string;
}
export interface NativeAuthority {
  prepareTeam(actor: NativeActor, credential: string): Promise<void>;
  verifyAdministrator(
    actor: NativeActor,
    credential: string,
  ): Promise<{ agentIds: string[] }>;
  enroll(
    actor: NativeActor,
    credential: string,
    person: Pick<User, "identity" | "name">,
    targetCredential: string,
  ): Promise<void>;
  revoke(
    actor: NativeActor,
    credential: string,
    identity: string,
    eligibleIdentities: readonly string[],
  ): Promise<void>;
}
export interface AccessRuntimeApi {
  authenticate(cookie: string): Promise<Session>;
  resolveSessionHash(hash: string): Promise<Session | null>;
  csrf(
    session: Session,
    origin: string | undefined,
    token: string | undefined,
  ): void;
  withEnrollmentSession<T>(
    hash: string,
    targetUserId: string,
    work: (credential: string) => Promise<T>,
  ): Promise<T>;
  withActingSession<T>(
    hash: string,
    work: (credential: string) => Promise<T>,
  ): Promise<T>;
}

export type { Session } from "./model.js";

/** Application composition contributes same-origin management destinations. */
export interface NavigationLink {
  label: string;
  href: string;
}
