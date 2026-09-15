import { copyFile, cp, mkdir } from "node:fs/promises";

// TypeScript emits the operator CLI; these runtime dependencies are not TypeScript.
const source = new URL("./packs/", import.meta.url);
const destination = new URL("../dist/scripts/packs/", import.meta.url);
await mkdir(destination, { recursive: true });
await Promise.all(
  ["transport.py", "requirements.in", "requirements.txt"].map((name) =>
    copyFile(new URL(name, source), new URL(name, destination)),
  ),
);
// Local setup runs migrations explicitly and consumes the pinned controller policy.
for (const path of [
  "services/access/migrations",
  "release/components.json",
  "deploy/openshell/policy.yaml",
]) {
  const destination = new URL(`../dist/${path}`, import.meta.url);
  await mkdir(new URL(".", destination), { recursive: true });
  await cp(new URL(`../${path}`, import.meta.url), destination, {
    recursive: true,
  });
}
