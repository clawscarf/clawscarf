import { CommonError } from "../shared/errors.js";
import type {
  ConnectionResultPage,
  ConnectionResultUnavailable,
} from "../types/model.js";
import type {
  ConnectionProtection,
  ConnectionInvocationStore,
} from "../types/ports.js";
import type { ConnectorRuntimePrincipal } from "../types/runtime-auth.js";
import {
  invalidPayload,
  pageBinding,
  RESULT_MAX_BYTES,
  RESULT_MAX_PAGES,
  RESULT_PAGE_BYTES,
  utf8PageEnd,
  type AvailablePayload,
} from "./result-payload.js";

interface Position {
  page: number;
  offset: number;
}

/** Cursors select a page; the caller must reauthorize before every read. */
export async function resultPage(input: {
  payload: AvailablePayload;
  principal: ConnectorRuntimePrincipal;
  agentId: string;
  protection: ConnectionProtection;
  invocations: ConnectionInvocationStore;
  cursor?: string;
}): Promise<ConnectionResultPage | ConnectionResultUnavailable> {
  const { payload, principal, agentId, protection } = input;
  const sign = (position: Position) =>
    protection.fingerprint(payload.reference.invocationId, {
      kind: "connection-result-page",
      reference: { ...payload.reference },
      ...principal,
      agentId,
      ...position,
    });
  let position: Position = { page: 0, offset: 0 };
  if (input.cursor !== undefined) {
    const cursor = decodeCursor(input.cursor);
    position = { page: cursor.page, offset: cursor.offset };
    if (
      cursor.signature !== sign(position) ||
      position.offset >= payload.reference.byteLength ||
      position.page >= payload.pageCount
    )
      invalidCursor();
  }
  const part = await readPage(input, position);
  if (!part) return invalidPayload();
  const end = position.offset + Buffer.byteLength(part, "utf8");
  const last = position.page === payload.pageCount - 1;
  if (
    end > payload.reference.byteLength ||
    (last
      ? end !== payload.reference.byteLength
      : end >= payload.reference.byteLength)
  )
    return invalidPayload();
  const next = { page: position.page + 1, offset: end };
  return {
    kind: "page",
    reference: payload.reference,
    text: part,
    offsetBytes: position.offset,
    nextCursor: last
      ? null
      : Buffer.from(
          JSON.stringify({ ...next, signature: sign(next) }),
        ).toString("base64url"),
  };
}

async function readPage(
  input: Parameters<typeof resultPage>[0],
  position: Position,
): Promise<string | null> {
  const { payload, protection } = input;
  if (payload.inline) {
    const { bytes } = payload.inline;
    return bytes
      .subarray(position.offset, utf8PageEnd(bytes, position.offset))
      .toString("utf8");
  }
  const id = payload.reference.invocationId;
  const sealed = await input.invocations.resultPage(
    input.principal,
    id,
    position.page,
  );
  if (!sealed) return null;
  try {
    const page = protection.open(pageBinding(id, position.page), sealed);
    if (
      !page ||
      typeof page !== "object" ||
      Array.isArray(page) ||
      Object.keys(page).length !== 2 ||
      page.offsetBytes !== position.offset ||
      typeof page.text !== "string" ||
      !page.text.length ||
      Buffer.byteLength(page.text, "utf8") > RESULT_PAGE_BYTES
    )
      return null;
    return page.text;
  } catch {
    return null;
  }
}

function decodeCursor(value: string): Position & { signature: string } {
  if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value))
    invalidCursor();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    invalidCursor();
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 3 ||
    !("offset" in parsed) ||
    !("page" in parsed) ||
    !("signature" in parsed) ||
    typeof parsed.offset !== "number" ||
    !Number.isSafeInteger(parsed.offset) ||
    parsed.offset < 0 ||
    parsed.offset > RESULT_MAX_BYTES ||
    typeof parsed.page !== "number" ||
    !Number.isSafeInteger(parsed.page) ||
    parsed.page < 0 ||
    parsed.page >= RESULT_MAX_PAGES ||
    typeof parsed.signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(parsed.signature)
  )
    invalidCursor();
  return {
    offset: parsed.offset,
    page: parsed.page,
    signature: parsed.signature,
  };
}

function invalidCursor(): never {
  throw new CommonError(
    "invalid_request",
    "The result cursor is invalid or no longer matches this result.",
  );
}
