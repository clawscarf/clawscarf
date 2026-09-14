import { Ajv2020 } from "ajv/dist/2020.js";
import type {
  ConnectorCatalogDetail,
  ConnectorCatalogIndex,
  ConnectorManifest,
} from "./artifact.js";
import { catalogDigest, parseCatalogJson } from "./artifact.js";
import { connectorFilePaths } from "./file-markers.js";

const identifier = { type: "string", pattern: "^[a-z][a-z0-9_]{0,99}$" };
const text = { type: "string", minLength: 1, maxLength: 65_536 };
const digest = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const metadata = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "description",
    "category",
    "iconUrl",
    "auth",
    "toolkitSlug",
  ],
  properties: {
    id: identifier,
    toolkitSlug: identifier,
    name: { ...text, maxLength: 200 },
    description: { ...text, maxLength: 4000 },
    category: { ...text, maxLength: 100 },
    iconUrl: { type: "string", pattern: "^https://[^\\s]+$", maxLength: 2000 },
    auth: {
      oneOf: [
        {
          type: "object",
          required: ["kind"],
          additionalProperties: false,
          properties: { kind: { const: "managed" } },
        },
        {
          type: "object",
          required: ["kind", "scheme"],
          additionalProperties: false,
          properties: {
            kind: { const: "custom" },
            scheme: { type: "string", pattern: "^[A-Z][A-Z0-9_]{0,99}$" },
          },
        },
      ],
    },
  },
};
const summaryProperties = {
  connectorId: identifier,
  id: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,255}$" },
  name: { ...text, maxLength: 300 },
  description: { ...text, maxLength: 500 },
  version: { ...text, maxLength: 200 },
  schemaDigest: digest,
};
const summary = {
  type: "object",
  additionalProperties: false,
  properties: summaryProperties,
  required: Object.keys(summaryProperties),
};
const ajv = new Ajv2020({ strict: true, allErrors: false });
const manifestValidator = ajv.compile<ConnectorManifest>({
  type: "object",
  additionalProperties: false,
  required: ["source", "connectors"],
  properties: {
    source: {
      type: "object",
      required: ["repository", "revision", "paths"],
      additionalProperties: false,
      properties: {
        repository: text,
        revision: { type: "string", pattern: "^[a-f0-9]{40}$" },
        paths: { type: "array", minItems: 1, items: text },
      },
    },
    connectors: { type: "array", maxItems: 2000, items: metadata },
  },
});
const indexValidator = ajv.compile<ConnectorCatalogIndex>({
  type: "object",
  additionalProperties: false,
  required: ["version", "manifestDigest", "connectors"],
  properties: {
    version: digest,
    manifestDigest: digest,
    connectors: {
      type: "array",
      maxItems: 2000,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["metadata", "actions", "detailDigest", "sourceDigest"],
        properties: {
          metadata,
          detailDigest: digest,
          sourceDigest: digest,
          actions: { type: "array", maxItems: 50_000, items: summary },
        },
      },
    },
  },
});
const detailValidator = ajv.compile<ConnectorCatalogDetail>({
  type: "object",
  additionalProperties: false,
  required: ["connectorId", "actions"],
  properties: {
    connectorId: identifier,
    actions: {
      type: "array",
      maxItems: 50_000,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          ...Object.keys(summaryProperties),
          "inputSchema",
          "outputSchema",
          "fileInputs",
          "fileOutputs",
        ],
        properties: {
          ...summaryProperties,
          description: text,
          inputSchema: {},
          outputSchema: {},
          fileInputs: {
            type: "array",
            items: { type: "string" },
            maxItems: 1000,
          },
          fileOutputs: {
            type: "array",
            items: { type: "string" },
            maxItems: 1000,
          },
        },
      },
    },
  },
});

export function readConnectorManifest(value: unknown): ConnectorManifest {
  if (!manifestValidator(value)) throw Error("Invalid connector manifest.");
  unique(value.connectors.map((entry) => entry.id));
  unique(value.connectors.map((entry) => entry.toolkitSlug));
  return value;
}

export function readCatalogIndex(value: unknown): ConnectorCatalogIndex {
  if (!indexValidator(value)) throw Error("Invalid connector catalog index.");
  unique(value.connectors.map((entry) => entry.metadata.id));
  for (const connector of value.connectors) {
    unique(connector.actions.map((action) => action.id));
    if (
      connector.actions.some(
        (action) => action.connectorId !== connector.metadata.id,
      )
    )
      throw Error("Connector catalog action ownership mismatch.");
  }
  if (
    catalogDigest({
      manifestDigest: value.manifestDigest,
      connectors: value.connectors,
    }) !== value.version
  )
    throw Error("Connector catalog integrity mismatch.");
  return value;
}

export function readCatalogDetail(value: unknown): ConnectorCatalogDetail {
  if (!detailValidator(value)) throw Error("Invalid connector catalog detail.");
  unique(value.actions.map((action) => action.id));
  for (const action of value.actions) {
    if (action.connectorId !== value.connectorId)
      throw Error("Connector catalog action ownership mismatch.");
    parseCatalogJson(action.inputSchema, 2 * 1024 * 1024);
    parseCatalogJson(action.outputSchema, 2 * 1024 * 1024);
    if (
      catalogDigest({
        inputSchema: action.inputSchema,
        outputSchema: action.outputSchema,
      }) !== action.schemaDigest
    )
      throw Error("Connector schema integrity mismatch.");
    if (
      JSON.stringify(
        connectorFilePaths(action.inputSchema, "file_uploadable"),
      ) !== JSON.stringify(action.fileInputs) ||
      JSON.stringify(
        connectorFilePaths(action.outputSchema, "file_downloadable"),
      ) !== JSON.stringify(action.fileOutputs)
    )
      throw Error("Connector file marker integrity mismatch.");
  }
  return value;
}

function unique(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length)
    throw Error("Duplicate connector catalog identity.");
}
