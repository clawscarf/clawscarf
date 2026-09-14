export const RESULT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Payload expiry never removes invocation identity, status or execution receipts. */
export interface ConnectionResultRetentionStore {
  expire(input: { completedBefore: Date; limit: number }): Promise<number>;
}
