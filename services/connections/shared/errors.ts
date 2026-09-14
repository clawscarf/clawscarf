/** Failure meaning is independent of REST status codes and provider wire formats. */
export type FailureCategory =
  | "invalid_input"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "precondition_failed"
  | "rate_limited"
  | "unavailable"
  | "payment_required"
  | "internal";
export type RetryGuidance =
  | { strategy: "after_delay"; afterSeconds: number }
  | { strategy: "never" | "after_change" | "reconcile" };
export interface FailureDefinition {
  category: FailureCategory;
  retry: RetryGuidance;
}

/** Subclasses own a closed vocabulary. Messages contain only safe, public detail. */
export abstract class DomainError<Code extends string = string> extends Error {
  readonly category: FailureCategory;
  readonly retry: RetryGuidance;
  protected constructor(
    readonly code: Code,
    definition: FailureDefinition,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
    this.category = definition.category;
    this.retry = definition.retry;
  }
}

export function isDomainError(error: unknown): error is DomainError<string> {
  return error instanceof DomainError;
}

const commonFailures = {
  invalid_request: {
    category: "invalid_input",
    retry: { strategy: "after_change" },
  },
  unauthenticated: {
    category: "unauthenticated",
    retry: { strategy: "after_change" },
  },
  forbidden: { category: "forbidden", retry: { strategy: "after_change" } },
  not_found: { category: "not_found", retry: { strategy: "never" } },
  idempotency_conflict: { category: "conflict", retry: { strategy: "never" } },
  revision_conflict: {
    category: "precondition_failed",
    retry: { strategy: "after_change" },
  },
} as const satisfies Record<string, FailureDefinition>;
export type CommonErrorCode = keyof typeof commonFailures;
export class CommonError extends DomainError<CommonErrorCode> {
  constructor(code: CommonErrorCode, message: string) {
    super(code, commonFailures[code], message);
  }
}
export class RateLimitError extends DomainError<"rate_limited"> {
  constructor(message: string, afterSeconds: number) {
    if (!Number.isSafeInteger(afterSeconds) || afterSeconds < 0)
      throw Error("Invalid retry delay.");
    super(
      "rate_limited",
      {
        category: "rate_limited",
        retry: { strategy: "after_delay", afterSeconds },
      },
      message,
    );
  }
}
export function denied(): never {
  throw new CommonError(
    "forbidden",
    "You do not have permission for this action.",
  );
}
export function missing(): never {
  throw new CommonError("not_found", "Resource not found.");
}
