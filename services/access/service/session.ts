import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AccessError } from "../types/errors.js";
import type { AccessStore, LoginProvider, Session } from "../types/model.js";
import type { NativeAuthority } from "../types/native.js";
export const token = () => randomBytes(32).toString("base64url");
export { hash } from "../types/credential.js";
import { hash } from "../types/credential.js";
export function safeReturn(
  value: string,
  applicationPath: (path: string) => boolean = () => false,
): string {
  const origin = "https://return.invalid";
  const url = new URL(value, origin);
  if (
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    ) ||
    url.origin !== origin ||
    url.hash ||
    (url.pathname.startsWith("/_clawscarf") &&
      url.pathname !== "/_clawscarf/setup-complete" &&
      !applicationPath(url.pathname)) ||
    url.pathname + url.search !== value
  )
    throw new AccessError("invalid_request", "Unsupported return destination.");
  return value;
}
/** Browser sessions with standalone admission and one origin. */
export class SessionService {
  constructor(
    private readonly store: AccessStore,
    private readonly provider: LoginProvider | null,
    private readonly origin: string,
    private readonly applicationReturnPath: (path: string) => boolean = () =>
      false,
    private readonly native?: NativeAuthority,
  ) {}
  validateReturn(value: string): string {
    return safeReturn(value, this.applicationReturnPath);
  }
  async startLogin(
    returnTo = "/",
    setupToken?: string,
    invitationToken?: string,
    reauthenticate = false,
  ) {
    if (!this.provider)
      throw new AccessError("dependency_unavailable", "Login is unavailable.");
    const next = this.validateReturn(returnTo);
    if (setupToken && invitationToken)
      throw new AccessError(
        "invalid_request",
        "Choose setup or an invitation.",
      );
    if (!setupToken && !(await this.store.administratorSetup()).complete)
      throw new AccessError(
        "administrator_setup_required",
        "Return to the installer for a private administrator sign-in link.",
      );
    const cookie = token(),
      state = token(),
      nonce = token(),
      codeVerifier = token();
    const url = await this.provider.authorization({
      reauthenticate,
      state,
      nonce,
      codeChallenge: createHash("sha256")
        .update(codeVerifier)
        .digest("base64url"),
    });
    await this.store.beginLogin(hash(cookie), {
      state,
      nonce,
      codeVerifier,
      returnTo: next,
      ...(setupToken ? { setupTokenHash: hash(setupToken) } : {}),
      ...(invitationToken
        ? { invitationTokenHash: hash(invitationToken) }
        : {}),
    });
    return { url, cookie };
  }
  async completeLogin(cookie: string, state: string, callbackUrl: string) {
    if (!this.provider)
      throw new AccessError("dependency_unavailable", "Login is unavailable.");
    const transaction = await this.store.consumeLogin(hash(cookie), state);
    if (!transaction) {
      if (!(await this.store.administratorSetup()).complete)
        throw new AccessError(
          "administrator_setup_required",
          "Return to the installer for a new administrator sign-in link.",
        );
      throw new AccessError(
        "invalid_authorization",
        "Login expired or was already used. Start again.",
      );
    }
    const { identity, logoutUrl } = await this.provider.exchange({
      ...transaction,
      callbackUrl,
    });
    if (!identity.emailVerified)
      throw new AccessError(
        "email_unverified",
        "Sign in with a verified email address.",
      );
    const setupTokenHash = transaction.setupTokenHash;
    const session = token();
    if (transaction.invitationTokenHash) {
      const digest = transaction.invitationTokenHash;
      await this.store.withEnrollmentLock(async (store) => {
        const native = this.native;
        if (!native)
          throw new AccessError(
            "dependency_unavailable",
            "Enrollment is unavailable.",
          );
        const credential = token();
        const sponsor = await store.bindInvitation(
          digest,
          identity,
          hash(credential),
        );
        try {
          const actor = {
            identity: sponsor.user.identity,
            sessionHash: sponsor.hash,
          };
          await this.native.verifyAdministrator(actor, credential);
          const person = await store.prepareEnrollment({
            ...identity,
            email: identity.email.toLowerCase(),
          });
          const sessions = new SessionService(
            store,
            this.provider,
            this.origin,
          );
          await sessions.withEnrollmentSession(
            sponsor.hash,
            person.id,
            (target) => native.enroll(actor, credential, person, target),
          );
          await this.native.verifyAdministrator(actor, credential);
          await store.finishInvitation(
            digest,
            person.id,
            hash(session),
            token(),
            logoutUrl,
          );
        } finally {
          await store.revokeDelegation(sponsor.hash);
        }
      });
      return { session, returnTo: this.validateReturn(transaction.returnTo) };
    }
    const user = setupTokenHash
      ? await this.store.withEnrollmentLock(async (store) => {
          if (!this.native)
            throw new AccessError(
              "dependency_unavailable",
              "Administrator setup is unavailable.",
            );
          const credential = token();
          const person = await store.bindAdministrator(
            setupTokenHash,
            identity,
            hash(credential),
          );
          try {
            const actor = {
              identity: person.identity,
              email: person.email,
              sessionHash: hash(credential),
            };
            await this.native.verifyAdministrator(actor, credential);
            await this.native.prepareTeam(actor, credential);
            await store.finishAdministratorSetup(
              setupTokenHash,
              person.id,
              hash(session),
              token(),
              logoutUrl,
            );
            return person;
          } finally {
            await store.revokeDelegation(hash(credential));
          }
        })
      : await this.store.admitIdentity(identity);
    if (!setupTokenHash)
      await this.store.createSession(
        user.id,
        hash(session),
        token(),
        logoutUrl,
      );
    return { session, returnTo: this.validateReturn(transaction.returnTo) };
  }
  async authenticate(value: string): Promise<Session> {
    const session = await this.store.authenticateSession(hash(value));
    if (!session)
      throw new AccessError("unauthenticated", "Sign in to continue.");
    return session;
  }
  csrf(
    session: Session,
    origin: string | undefined,
    value: string | undefined,
  ) {
    if (
      origin !== this.origin ||
      !timingSafeEqual(
        Buffer.from(hash(value ?? "")),
        Buffer.from(hash(session.csrfToken)),
      )
    )
      throw new AccessError("csrf_failed", "Refresh before submitting again.");
  }
  async withEnrollmentSession<T>(
    parentHash: string,
    userId: string,
    work: (credential: string) => Promise<T>,
  ): Promise<T> {
    const credential = token();
    await this.store.createEnrollmentDelegation(
      parentHash,
      userId,
      hash(credential),
    );
    try {
      return await work(credential);
    } finally {
      await this.store.revokeDelegation(hash(credential));
    }
  }
  async withActingSession<T>(
    parentHash: string,
    work: (credential: string) => Promise<T>,
  ): Promise<T> {
    const credential = token();
    await this.store.createDelegation(parentHash, hash(credential));
    try {
      return await work(credential);
    } finally {
      await this.store.revokeDelegation(hash(credential));
    }
  }

  async logout(session: Session) {
    const providerUrl = await this.store.revokeSession(session.hash);
    return (
      providerUrl ?? new URL("/_clawscarf/signed-out", this.origin).toString()
    );
  }
}
