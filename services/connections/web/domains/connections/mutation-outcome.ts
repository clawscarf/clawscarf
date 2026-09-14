import { ApiError } from "../../shared/api/client.js";

/** A missing response or missing completion guidance cannot authorize a new intent. */
export function connectionMutationUncertain(error: unknown): boolean {
  return (
    !!error &&
    (!(error instanceof ApiError) ||
      !error.problem.retry ||
      error.problem.retry.strategy === "reconcile")
  );
}
