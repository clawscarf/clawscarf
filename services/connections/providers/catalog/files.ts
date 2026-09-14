import { open } from "node:fs/promises";

/** Bound reads before JSON decoding; a growing file cannot bypass the byte limit. */
export async function readCatalogFile(
  path: string,
  maximumBytes: number,
): Promise<unknown> {
  const file = await open(path, "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > maximumBytes)
      throw Error(
        "Catalog file exceeds its byte limit or is not a regular file.",
      );
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maximumBytes - size + 1));
      const { bytesRead } = await file.read(chunk);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > maximumBytes)
        throw Error("Catalog file exceeds its byte limit.");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const value: unknown = JSON.parse(
      Buffer.concat(chunks, size).toString("utf8"),
    );
    return value;
  } finally {
    await file.close();
  }
}
