import { AccessError } from "../types/errors.js";
import type { AccessStore, Identity, Session } from "../types/model.js";
import type { NativeAuthority } from "../types/native.js";
import { SessionService } from "./session.js";
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
  private async authorized<T>(
    actor: Session,
    store: AccessStore,
    work: (sessions: SessionService, credential: string) => Promise<T>,
  ) {
    const current = await store.authenticateSession(actor.hash);
    if (!current || current.user.id !== actor.user.id)
      throw new AccessError("unauthenticated", "Sign in to continue.");
    const sessions = new SessionService(store, null, this.origin);
    return sessions.withActingSession(actor.hash, async (credential) => {
      await this.native.verifyAdministrator(
        {
          identity: current.user.identity,
          name: current.user.name,
          sessionHash: current.hash,
        },
        credential,
      );
      return work(sessions, credential);
    });
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
      this.authorized(actor, store, (sessions, credential) =>
        work(store, sessions, credential),
      ),
    );
  }
  list(actor: Session) {
    return this.authorized(actor, this.store, () => this.store.people());
  }
  prepareTeam(actor: Session) {
    return this.change(actor, (_store, _sessions, credential) =>
      this.native.prepareTeam(
        {
          identity: actor.user.identity,
          name: actor.user.name,
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
