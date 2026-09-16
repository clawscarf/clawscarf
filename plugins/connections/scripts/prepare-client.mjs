import { cp, rm } from "node:fs/promises";

// Stage the shared generated transport for this independently packaged plugin.
const target = new URL("../generated/http/", import.meta.url);
await rm(target, { recursive: true, force: true });
await cp(new URL("../../../generated/http/", import.meta.url), target, {
  recursive: true,
});
await rm(new URL("../src/generated/", import.meta.url), {
  recursive: true,
  force: true,
});
