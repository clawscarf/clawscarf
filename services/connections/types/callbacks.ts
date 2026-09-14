/** Provider-confirmed identity evidence; it never substitutes for current authorization. */
export interface CallbackIdentity {
  projectId: string;
  subjectId: string;
  accountId: string;
  toolkit: string;
}

export interface CallbackRecord {
  hash: string;
  userId: string;
  state: "verifying" | "complete";
  connectionId: string | null;
  /** A claimed callback without a receipt has no confirmed identity. */
  identity: CallbackIdentity | null;
}

export interface ConnectionCallbackStore {
  get(hash: string, userId: string): Promise<CallbackRecord | null>;
  claim(hash: string, userId: string): Promise<boolean>;
  /** Save confirmed evidence once; an exact replay is harmless, a different receipt is rejected. */
  retain(
    hash: string,
    userId: string,
    identity: CallbackIdentity,
  ): Promise<void>;
  byAccount(
    userId: string,
    projectId: string,
    accountId: string,
  ): Promise<CallbackRecord | null>;
  /** Completion requires this user's retained identity receipt and cannot change its destination. */
  complete(hash: string, userId: string, connectionId: string): Promise<void>;
}
