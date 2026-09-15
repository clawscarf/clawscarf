import { copyFile, mkdir } from "node:fs/promises";

// TypeScript emits the operator CLI; these runtime dependencies are not TypeScript.
const source = new URL("./packs/", import.meta.url);
const destination = new URL("../dist/scripts/packs/", import.meta.url);
await mkdir(destination, { recursive: true });
await Promise.all(
  ["transport.py", "requirements.in", "requirements.txt"].map((name) =>
    copyFile(new URL(name, source), new URL(name, destination)),
  ),
);
