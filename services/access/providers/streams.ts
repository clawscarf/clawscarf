import type { IngressAuthority } from "../types/ingress.js";
export interface TrackedStream {
  session: string;
  identity: string | null;
  checkedAt: number;
  close(): void;
}
/** RawClaw's revocation rechecks: healthy connections have no maximum lifetime. */
export class SessionStreams {
  readonly active = new Set<TrackedStream>();
  private readonly pending = new Set<string>();
  private stopped = false;
  constructor(private readonly authority: IngressAuthority) {}
  tick() {
    if (this.stopped) return;
    for (const stream of this.active)
      if (performance.now() - stream.checkedAt > 15_000) stream.close();
    for (const session of new Set(
      [...this.active].filter((s) => s.identity !== null).map((s) => s.session),
    )) {
      if (this.pending.has(session)) continue;
      this.pending.add(session);
      void this.check(session);
    }
  }
  private async check(session: string) {
    const selected = [...this.active].filter(
      (s) => s.session === session && s.identity !== null,
    );
    const checkedAt = performance.now();
    try {
      const result = await this.authority.authenticate(session);
      if (this.stopped) return;
      for (const stream of selected.filter((s) => this.active.has(s))) {
        if (stream.identity !== result.identity) stream.close();
        else stream.checkedAt = checkedAt;
      }
    } catch {
      for (const stream of selected) stream.close();
    } finally {
      this.pending.delete(session);
    }
  }
  close() {
    this.stopped = true;
    for (const stream of this.active) stream.close();
  }
}
