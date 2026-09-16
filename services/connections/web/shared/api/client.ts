import { createApiClient } from "./transport.js";
let csrfToken: string | undefined;
export const client = createApiClient({
  baseUrl: window.location.origin,
  csrfToken: () => csrfToken,
});
export const request = { client, throwOnError: true } as const;
export function setCsrfToken(value: string | undefined) {
  csrfToken = value;
}
export { data, ApiError, requestSignal } from "./transport.js";
export * as api from "../../../generated/sdk.gen.js";
