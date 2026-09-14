import { DomainError, type FailureDefinition } from "../shared/errors.js";
const failures = {
  connector_native_unavailable: {
    category: "unavailable",
    retry: { strategy: "after_change" },
  },
  connection_return_capacity: {
    category: "rate_limited",
    retry: { strategy: "after_change" },
  },
  connection_return_expired: {
    category: "not_found",
    retry: { strategy: "after_change" },
  },
  connector_install_pending: {
    category: "conflict",
    retry: { strategy: "after_change" },
  },
  connection_unavailable: {
    category: "conflict",
    retry: { strategy: "after_change" },
  },
  connection_setup_pending: {
    category: "conflict",
    retry: { strategy: "after_change" },
  },
  connection_setup_expired: {
    category: "conflict",
    retry: { strategy: "after_change" },
  },
  connection_callback_used: {
    category: "conflict",
    retry: { strategy: "reconcile" },
  },
  connector_catalog_changed: {
    category: "conflict",
    retry: { strategy: "after_change" },
  },
  connector_capacity_exceeded: {
    category: "rate_limited",
    retry: { strategy: "after_change" },
  },
  connector_credential_revoked: {
    category: "unauthenticated",
    retry: { strategy: "after_change" },
  },
} as const satisfies Record<string, FailureDefinition>;
export class ConnectionError extends DomainError<keyof typeof failures> {
  constructor(code: keyof typeof failures, message: string) {
    super(code, failures[code], message);
  }
}
