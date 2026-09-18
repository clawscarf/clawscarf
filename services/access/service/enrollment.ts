import { AccessError } from "../types/errors.js";
import type { AccessStore, Identity, Session } from "../types/model.js";
import type { NativeAuthority } from "../types/native.js";
import { SessionService, hash, token } from "./session.js";
/** Serializes companion enrollment; native adapter also guards native config revisions. */
export class EnrollmentService {
  constructor(
    private readonly store: AccessStore,
    private readonly native: NativeAuthority,
    private readonly origin: string,
    private readonly issuer: string | null,
  ) {}
  get enabled() {
    return this.issuer !== null;
  }
  private async authenticated<T>(
    actor: Session,
    store: AccessStore,
    work: (
      sessions: SessionService,
      credential: string,
      current: Session,
    ) => Promise<T>,
  ) {
    const current = await store.authenticateSession(actor.hash);
    if (!current || current.user.id !== actor.user.id)
      throw new AccessError("unauthenticated", "Sign in to continue.");
    const sessions = new SessionService(store, null, this.origin);
    return sessions.withActingSession(actor.hash, (credential) =>
      work(sessions, credential, current),
    );
  }
  private change<T>(
    actor: Session,
    work: (
      store: AccessStore,
      sessions: SessionService,
      credential: string,
    ) => Promise<T>,
  ) {
    return this.store.withEnrollmentLock((store) =>
      this.authenticated(
        actor,
        store,
        async (sessions, credential, current) => {
          await this.native.verifyAdministrator(
            {
              identity: current.user.identity,
              name: current.user.name,
              sessionHash: current.hash,
            },
            credential,
          );
          return work(store, sessions, credential);
        },
      ),
    );
  }
  list(actor: Session) {
    return this.authenticated(
      actor,
      this.store,
      async (_sessions, credential, current) => {
        const observed = await this.native.people(
          {
            identity: current.user.identity,
            name: current.user.name,
            sessionHash: current.hash,
          },
          credential,
        );
        return {
          people: (await this.store.people()).map((person) => ({
            ...person,
            role:
              observed.people.find(
                (profile) => profile.identity === person.identity,
              )?.role ?? null,
          })),
          roles: observed.roles,
          enrollment: observed.enrollment,
        };
      },
    );
  }
  prepareTeam(actor: Session) {
    return this.change(actor, (_store, _sessions, credential) =>
      this.native.prepareTeam(
        {
          identity: actor.user.identity,
          email: actor.user.email,
          sessionHash: actor.hash,
        },
        credential,
      ),
    );
  }
  enroll(actor: Session, input: Pick<Identity, "subject" | "email" | "name">) {
    if (!this.issuer)
      throw new AccessError(
        "forbidden",
        "Team enrollment requires company login.",
      );
    const identity: Identity = {
      ...input,
      issuer: this.issuer,
      emailVerified: false,
    };
    return this.change(actor, async (store, sessions, credential) => {
      const person = await store.prepareEnrollment(identity);
      await sessions.withEnrollmentSession(actor.hash, person.id, (target) =>
        this.native.enroll(
          {
            identity: actor.user.identity,
            name: actor.user.name,
            sessionHash: actor.hash,
          },
          credential,
          person,
          target,
        ),
      );
      await store.activateEnrollment(person.id);
      return person;
    });
  }
  setRole(
    actor: Session,
    userId: string,
    role: string,
    expectedRole: string | null,
  ) {
    return this.change(actor, async (store, _sessions, credential) => {
      const person = await store.person(userId);
      if (!person) throw new AccessError("invalid_request", "Unknown person.");
      await this.native.setRole(
        { identity: actor.user.identity, sessionHash: actor.hash },
        credential,
        person.identity,
        role,
        expectedRole,
        await store.eligibleIdentities(),
      );
    });
  }
  invitations(actor: Session) {
    return this.authenticated(
      actor,
      this.store,
      async (_sessions, credential, current) => {
        await this.native.verifyAdministrator(
          { identity: current.user.identity, sessionHash: current.hash },
          credential,
        );
        return { invitations: await this.store.invitations() };
      },
    );
  }
  invite(actor: Session, email: string) {
    if (!this.enabled)
      throw new AccessError("forbidden", "Invitations require company login.");
    return this.change(actor, async (store, _sessions, credential) => {
      // Observe only: incomplete native setup must never be repaired by creating an invitation.
      if (
        (await this.native.observeTeam(
          { identity: actor.user.identity, sessionHash: actor.hash },
          credential,
        )) !== "ready"
      )
        throw new AccessError(
          "invalid_request",
          "Prepare team access before inviting people.",
        );
      const secret = token();
      const invitation = await store.createInvitation(
        actor.user.id,
        email,
        hash(secret),
      );
      const url = new URL("/_clawscarf/login", this.origin);
      url.searchParams.set("invitation", secret);
      return { invitation, url: url.toString() };
    });
  }
  revokeInvitation(actor: Session, id: string) {
    return this.change(actor, (store) => store.revokeInvitation(id));
  }
  remove(actor: Session, userId: string) {
    return this.change(actor, async (store, _sessions, credential) => {
      const person = await store.person(userId);
      if (!person) throw new AccessError("invalid_request", "Unknown person.");
      await this.native.revoke(
        {
          identity: actor.user.identity,
          name: actor.user.name,
          sessionHash: actor.hash,
        },
        credential,
        person.identity,
        await store.eligibleIdentities(),
      );
      await store.removeEnrollment(person.id);
    });
  }
}
