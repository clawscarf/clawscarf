import {
  RESULT_RETENTION_MS,
  type ConnectionResultRetentionStore,
} from "../types/result-retention.js";

export class ConnectionResultRetentionService {
  constructor(private readonly store: ConnectionResultRetentionStore) {}

  sweep() {
    return this.store.expire({
      completedBefore: new Date(Date.now() - RESULT_RETENTION_MS),
      limit: 100,
    });
  }
}
