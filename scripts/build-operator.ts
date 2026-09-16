import { copyFile, cp, mkdir } from "node:fs/promises";

// TypeScript emits the operator CLI; these runtime dependencies are not TypeScript.
const source = new URL("./packs/", import.meta.url);
const destination = new URL("../dist/scripts/packs/", import.meta.url);
await mkdir(destination, { recursive: true });
await mkdir(new URL("../dist/scripts/local/", import.meta.url), {
  recursive: true,
});
await copyFile(
  new URL("./local/upgrade-rpc.py", import.meta.url),
  new URL("../dist/scripts/local/upgrade-rpc.py", import.meta.url),
);
await Promise.all(
  ["transport.py", "requirements.in", "requirements.txt"].map((name) =>
    copyFile(new URL(name, source), new URL(name, destination)),
  ),
);
// Local setup runs migrations explicitly and consumes the pinned controller policy.
for (const path of [
  "services/access/migrations",
  "services/connections/migrations",
  "release/components.json",
  "deploy/recipes",
  "deploy/openshell/policy.yaml",
  "deploy/execution/worker/policy.yaml",
  "deploy/execution/browser/seccomp.json",
  "deploy/execution/network/node-ingress.cfg",
  "deploy/execution/browser/LICENSE.playwright",
]) {
  const destination = new URL(`../dist/${path}`, import.meta.url);
  await mkdir(new URL(".", destination), { recursive: true });
  await cp(new URL(`../${path}`, import.meta.url), destination, {
    recursive: true,
  });
}
