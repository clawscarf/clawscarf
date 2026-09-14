import { Ajv2020 } from "ajv/dist/2020.js";
import { CommonError } from "../../shared/errors.js";
import type {
  ConnectorCatalogRetirement,
  ConnectorCatalogUsage,
} from "../../types/catalog.js";

const validateUsage = new Ajv2020({
  strict: true,
}).compile<ConnectorCatalogUsage>({
  type: "object",
  additionalProperties: false,
  required: ["catalogVersion", "references"],
  properties: {
    catalogVersion: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    references: {
      type: "array",
      maxItems: 100_000,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["connectorId", "kind", "resourceId"],
        properties: {
          connectorId: { type: "string", pattern: "^[a-z][a-z0-9_]{0,99}$" },
          kind: { enum: ["connection", "setup", "cleanup", "invocation"] },
          resourceId: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
    },
  },
});

export function readConnectorCatalogUsage(
  value: unknown,
): ConnectorCatalogUsage {
  if (!validateUsage(value))
    throw new CommonError(
      "invalid_request",
      "Connector usage snapshot is invalid.",
    );
  return value;
}

export function checkConnectorCatalogRetirement(input: {
  currentVersion: string;
  currentConnectorIds: readonly string[];
  nextConnectorIds: readonly string[];
  usage: ConnectorCatalogUsage;
}): ConnectorCatalogRetirement {
  readConnectorCatalogUsage(input.usage);
  if (input.currentVersion !== input.usage.catalogVersion)
    throw new CommonError(
      "revision_conflict",
      "Connector usage does not match the current catalog version.",
    );
  const current = new Set(input.currentConnectorIds);
  const next = new Set(input.nextConnectorIds);
  if (
    current.size !== input.currentConnectorIds.length ||
    next.size !== input.nextConnectorIds.length
  )
    throw new CommonError(
      "invalid_request",
      "Connector catalog identities must be unique.",
    );
  if (
    input.usage.references.some(
      (reference) => !current.has(reference.connectorId),
    )
  )
    throw new CommonError(
      "invalid_request",
      "Connector usage references a service outside the current catalog.",
    );
  const removedConnectorIds = [...current].filter((id) => !next.has(id)).sort();
  const removed = new Set(removedConnectorIds);
  const blockers = input.usage.references
    .filter((reference) => removed.has(reference.connectorId))
    .sort(
      (left, right) =>
        left.connectorId.localeCompare(right.connectorId) ||
        left.kind.localeCompare(right.kind) ||
        left.resourceId.localeCompare(right.resourceId),
    );
  return { removedConnectorIds, blockers: structuredClone(blockers) };
}
