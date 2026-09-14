export const CONNECTION_RETURN_TTL_SECONDS = 600;

/** An encrypted provider return, bound to the browser that received it. */
export interface ConnectionReturnRecord {
  id: string;
  cookieHash: string;
  sessionHash: string;
  sealedSession: string;
  expiresAt: string;
}

export interface ConnectionReturnStore {
  /** Reuse an unexpired exact browser/session pair without extending its lifetime; null means capacity. */
  stage(
    record: Omit<ConnectionReturnRecord, "expiresAt">,
  ): Promise<ConnectionReturnRecord | null>;
  get(id: string, cookieHash: string): Promise<ConnectionReturnRecord | null>;
}
