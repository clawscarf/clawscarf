import type { Problem } from "../generated/client/types.gen.js";
export const request = {
  baseUrl: window.location.origin,
  credentials: "same-origin",
  throwOnError: true,
} as const;
export function problem(error: unknown): Partial<Problem> {
  return typeof error === "object" && error !== null ? error : {};
}
