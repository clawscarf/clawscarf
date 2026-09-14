import type { ConnectorJson } from "../../types/catalog.js";
import { parseCatalogJson } from "./artifact.js";

const MAX_PAGE_BYTES = 32 * 1024 * 1024;
const MAX_TOOLS = 50_000;

export async function fetchConnectorTools(input: {
  toolkit: string;
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<ConnectorJson[]> {
  const baseUrl = new URL(input.baseUrl);
  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  )
    throw Error("Catalog API base must be a credential-free HTTPS URL.");
  const tools: ConnectorJson[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const url = new URL("/api/v3.1/tools", baseUrl);
    url.searchParams.set("toolkit_slug", input.toolkit);
    url.searchParams.set("include_deprecated", "false");
    url.searchParams.set("toolkit_versions", "latest");
    url.searchParams.set("limit", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await (input.fetchImpl ?? fetch)(url, {
      headers: { "x-api-key": input.apiKey, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(`Catalog request failed with HTTP ${response.status}.`);
    }
    if (!response.body)
      throw Error("Catalog provider returned an empty response.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > MAX_PAGE_BYTES)
          throw Error("Catalog page exceeds its byte limit.");
        chunks.push(item.value);
      }
    } finally {
      await reader.cancel();
    }
    const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const page = parseCatalogJson(raw, MAX_PAGE_BYTES);
    if (
      !page ||
      typeof page !== "object" ||
      Array.isArray(page) ||
      !Array.isArray(page.items)
    )
      throw Error("Catalog provider returned an invalid page.");
    tools.push(...page.items);
    if (tools.length > MAX_TOOLS)
      throw Error("Catalog toolkit exceeds its action limit.");
    const next = page.next_cursor;
    if (next !== undefined && next !== null && typeof next !== "string")
      throw Error("Catalog provider returned an invalid cursor.");
    cursor = typeof next === "string" && next.length ? next : null;
    if (cursor && (cursor.length > 4096 || seenCursors.has(cursor)))
      throw Error("Catalog provider repeated or exceeded its cursor limit.");
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return tools;
}
