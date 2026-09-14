import { createHash } from "node:crypto";
import type { ConnectorJson } from "../types/catalog.js";
import type {
  ConnectionInvocationRecord,
  ConnectionResultReference,
  ConnectionResultUnavailable,
} from "../types/model.js";
import type { ConnectionProtection } from "../types/ports.js";
import { RESULT_RETENTION_MS } from "../types/result-retention.js";
import { requireConnectorJson } from "../types/validation.js";

export const INLINE_RESULT_MAX_BYTES = 32 * 1024;
export const RESULT_PAGE_BYTES = 8 * 1024;
export const RESULT_MAX_BYTES = 8 * 1024 * 1024;
export const RESULT_MAX_PAGES = 1025;

export interface SealedInvocationPayload {
  sealedResult: string | null;
  sealedResultManifest: string | null;
  pages: string[];
}
export interface AvailablePayload {
  kind: "available";
  reference: ConnectionResultReference;
  pageCount: number;
  inline: { data: ConnectorJson; bytes: Buffer } | null;
}

export const pageBinding = (id: string, page: number) => `${id}:page:${page}`;

export function utf8PageEnd(bytes: Buffer, offset: number) {
  let end = Math.min(offset + RESULT_PAGE_BYTES, bytes.length);
  while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  return end;
}

/** Large results are split once; each read authenticates only its manifest and page. */
export function sealInvocationPayload(
  id: string,
  data: ConnectorJson,
  protection: ConnectionProtection,
): SealedInvocationPayload {
  try {
    const json = requireConnectorJson(data, RESULT_MAX_BYTES);
    const bytes = Buffer.from(JSON.stringify(json), "utf8");
    if (bytes.length <= INLINE_RESULT_MAX_BYTES)
      return {
        sealedResult: protection.seal(id, json),
        sealedResultManifest: null,
        pages: [],
      };
    const pages: string[] = [];
    for (let offset = 0; offset < bytes.length;) {
      const end = utf8PageEnd(bytes, offset);
      pages.push(
        protection.seal(pageBinding(id, pages.length), {
          offsetBytes: offset,
          text: bytes.subarray(offset, end).toString("utf8"),
        }),
      );
      offset = end;
    }
    return {
      sealedResult: null,
      sealedResultManifest: protection.seal(id, {
        byteLength: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        pageCount: pages.length,
      }),
      pages,
    };
  } catch {
    return { sealedResult: null, sealedResultManifest: null, pages: [] };
  }
}

/** Expiry is enforced before decrypting, independently of physical cleanup. */
export function readInvocationPayload(
  record: ConnectionInvocationRecord,
  protection: ConnectionProtection,
): AvailablePayload | ConnectionResultUnavailable {
  if (!record.sealedResult && !record.sealedResultManifest)
    return {
      kind: "unavailable",
      reason: record.resultUnavailable ?? "invalid_result",
    };
  const expires = Date.parse(record.completedAt ?? "") + RESULT_RETENTION_MS;
  if (!Number.isFinite(expires)) return invalidPayload();
  if (expires <= Date.now()) return { kind: "unavailable", reason: "expired" };
  try {
    if (record.sealedResult && record.sealedResultManifest)
      return invalidPayload();
    const base = {
      kind: "reference" as const,
      invocationId: record.id,
      mediaType: "application/json" as const,
      expiresAt: new Date(expires).toISOString(),
    };
    if (record.sealedResultManifest) {
      const manifest = protection.open(record.id, record.sealedResultManifest);
      if (
        !manifest ||
        typeof manifest !== "object" ||
        Array.isArray(manifest) ||
        Object.keys(manifest).length !== 3 ||
        typeof manifest.byteLength !== "number" ||
        !Number.isSafeInteger(manifest.byteLength) ||
        manifest.byteLength <= INLINE_RESULT_MAX_BYTES ||
        manifest.byteLength > RESULT_MAX_BYTES ||
        typeof manifest.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
        typeof manifest.pageCount !== "number" ||
        !Number.isSafeInteger(manifest.pageCount) ||
        manifest.pageCount <
          Math.ceil(manifest.byteLength / RESULT_PAGE_BYTES) ||
        manifest.pageCount >
          Math.ceil(manifest.byteLength / (RESULT_PAGE_BYTES - 3))
      )
        return invalidPayload();
      return {
        kind: "available",
        inline: null,
        pageCount: manifest.pageCount,
        reference: {
          ...base,
          byteLength: manifest.byteLength,
          sha256: manifest.sha256,
        },
      };
    }
    if (!record.sealedResult) return invalidPayload();
    const data = protection.open(record.id, record.sealedResult);
    const bytes = Buffer.from(JSON.stringify(data), "utf8");
    if (bytes.length > INLINE_RESULT_MAX_BYTES) return invalidPayload();
    let pageCount = 0;
    for (let offset = 0; offset < bytes.length; pageCount++)
      offset = utf8PageEnd(bytes, offset);
    return {
      kind: "available",
      inline: { data, bytes },
      pageCount,
      reference: {
        ...base,
        byteLength: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    };
  } catch {
    return invalidPayload();
  }
}

export function invalidPayload(): ConnectionResultUnavailable {
  return { kind: "unavailable", reason: "invalid_result" };
}
