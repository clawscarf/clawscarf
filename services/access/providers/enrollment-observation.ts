import { setTimeout as delay } from "node:timers/promises";
import { NativeFailure } from "../types/native-errors.js";

/** Persisted config can precede effective trusted-proxy admission after a native reload. */
export async function observeEnrollmentConnection(
  verifyReadOnlyGrant: () => Promise<void>,
  connectPendingIdentity: () => Promise<void>,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    // Recheck with the acting administrator before each private target connection.
    // Neither a removed allow-list entry nor an expanded scope may be overlooked.
    let verified = false;
    try {
      await verifyReadOnlyGrant();
      verified = true;
      await connectPendingIdentity();
      return;
    } catch (error) {
      if (
        !(error instanceof NativeFailure) ||
        attempt >= 11 ||
        !(
          error.code === "unavailable" ||
          (verified && error.code === "access_denied")
        )
      )
        throw error;
      await delay(750);
    }
  }
}
