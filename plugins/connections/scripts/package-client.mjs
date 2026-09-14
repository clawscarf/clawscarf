import { cp } from "node:fs/promises";
import { resolve } from "node:path";

await cp(
  resolve(import.meta.dirname, "../src/generated"),
  resolve(import.meta.dirname, "../dist/generated"),
  { recursive: true },
);
