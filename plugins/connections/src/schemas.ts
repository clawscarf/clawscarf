import { brokerEndpoint } from "./endpoint.ts";
import { Type, type Static } from "typebox";

const identity = Type.String({ minLength: 1, maxLength: 256 });

export const configSchema = Type.Object(
  {
    brokerUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    credential: Type.Optional(
      Type.Union([
        Type.String({ minLength: 1 }),
        Type.Object(
          {
            source: Type.Union([
              Type.Literal("env"),
              Type.Literal("file"),
              Type.Literal("exec"),
            ]),
            provider: Type.String({ minLength: 1 }),
            id: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
      ]),
    ),
  },
  { additionalProperties: false },
);

export const searchParameters = Type.Object(
  {
    query: Type.Optional(
      Type.String({
        maxLength: 500,
        description:
          "Words describing the service or operation to find. Start with only this field; other filters are optional.",
      }),
    ),
    connectionId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 256,
        description:
          "Exact connection.id returned by an earlier search, never an account name. Omit on the first search.",
      }),
    ),
    connectorId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 100,
        description:
          "Exact connectorId returned by discovery. Omit unless already known.",
      }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25 })),
    cursor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 2000,
        description:
          "Opaque nextCursor from a previous search. Omit for the first page; never invent a cursor or use a page number.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const describeParameters = Type.Object(
  { connectionId: identity, actionId: identity },
  { additionalProperties: false },
);

export const executeParameters = Type.Object(
  {
    mode: Type.Literal("execute"),
    connectionId: identity,
    actionId: identity,
    generation: Type.Integer({ minimum: 1, maximum: 2147483647 }),
    version: Type.String({ minLength: 1, maxLength: 200 }),
    arguments: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

export const resultParameters = Type.Object(
  {
    mode: Type.Literal("result"),
    invocationId: identity,
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  },
  { additionalProperties: false },
);

export const lookupParameters = Type.Object(
  { mode: Type.Literal("lookup"), toolCallId: identity },
  { additionalProperties: false },
);

export const callParameters = Type.Union([
  executeParameters,
  resultParameters,
  lookupParameters,
]);

export type ConnectorConfig = Static<typeof configSchema>;
export type SearchParameters = Static<typeof searchParameters>;
export type DescribeParameters = Static<typeof describeParameters>;
export type CallParameters = Static<typeof callParameters>;

/** Empty configuration disables tools; partial or unresolved configuration is an error. */
export function hasConnectionConfiguration(config: ConnectorConfig): boolean {
  if (config.brokerUrl === undefined && config.credential === undefined)
    return false;
  if (
    !config.brokerUrl ||
    typeof config.credential !== "string" ||
    !config.credential.trim()
  )
    throw new Error(
      "Connections requires a broker URL and resolved credential.",
    );
  brokerEndpoint(config.brokerUrl);
  return true;
}
