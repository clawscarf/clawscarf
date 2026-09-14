/** OpenAPI validates the quoted header; services check its current revision. */
export const connectionRevision = (value: string) => Number(value.slice(1, -1));
