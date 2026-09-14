const MAXIMUM_DIAGNOSTIC_BYTES = 2048;

/** Preserve only provider diagnostic fields; never stringify account/configuration bodies. */
export function providerDiagnostic(
  value: unknown,
  protectedValues: readonly string[],
): string | null {
  const lines: string[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 3 || lines.length >= 8) return;
    if (typeof node === "string") {
      lines.push(node);
      return;
    }
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const key of ["message", "detail", "error", "description"]) {
      const child: unknown = Reflect.get(node, key);
      if (typeof child === "string" || (child && typeof child === "object"))
        visit(child, depth + 1);
    }
  };
  visit(value, 0);
  let detail = lines.join(" ");
  for (const secret of protectedValues) {
    if (secret) detail = detail.replaceAll(secret, "[redacted]");
  }
  detail = detail
    .replaceAll(/https?:\/\/[^\s<>"']+/giu, "[redacted URL]")
    .replaceAll(/\bBearer\s+[^\s,;]+/giu, "[redacted]")
    .replaceAll(
      /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "[redacted credential]",
    )
    .replaceAll(/\b[A-Za-z0-9_-]{32,}\b/gu, "[redacted]")
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (!detail) return null;
  const bounded: string[] = [];
  let bytes = 0;
  for (const character of detail) {
    bytes += Buffer.byteLength(character);
    if (bytes > MAXIMUM_DIAGNOSTIC_BYTES) break;
    bounded.push(character);
  }
  return bounded.join("");
}
