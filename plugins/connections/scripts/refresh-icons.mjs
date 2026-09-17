import { readFile, writeFile } from "node:fs/promises";

// Release assets: never load third-party images in an authenticated native page.
const catalog = JSON.parse(
  await readFile(
    new URL(
      "../../../services/connections/catalog/manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const icons = {};
for (const { iconUrl } of catalog.connectors) {
  if (!iconUrl || icons[iconUrl]) continue;
  const response = await globalThis.fetch(iconUrl, {
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  const type = response.headers.get("content-type")?.split(";")[0];
  if (
    !response.ok ||
    !["image/svg+xml", "image/png", "image/webp"].includes(type)
  )
    throw Error(`Cannot package catalog icon: ${iconUrl}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > 256_000)
    throw Error(`Catalog icon exceeds size limit: ${iconUrl}`);
  icons[iconUrl] = `data:${type};base64,${data.toString("base64")}`;
}
await writeFile(
  new URL("../assets/icons.json", import.meta.url),
  JSON.stringify(icons, null, 2) + "\n",
);
