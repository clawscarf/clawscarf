import assert from "node:assert/strict";
import { test } from "node:test";
import { browserArtifactsVolumeOptions } from "../../scripts/deployment/browser-node.js";
import { ensureOwnedVolume } from "../../scripts/deployment/volumes.js";

await test("artifact volumes reject foreign owners and unbounded retained mounts", async () => {
  const expected = [
    "local",
    ...Object.values(browserArtifactsVolumeOptions),
  ].join("|");
  for (const [owner, options, accepted] of [
    ["team", expected, true],
    ["foreign", expected, false],
    ["team", "local|<no value>|<no value>|<no value>", false],
  ] as const) {
    const check = ensureOwnedVolume(
      "artifacts",
      "team",
      browserArtifactsVolumeOptions,
      (_command, args) => {
        if (args[1] === "ls") return Promise.resolve("artifacts");
        assert.equal(args[1], "inspect");
        return Promise.resolve(
          args.at(-1)?.includes("clawscarf.installation") ? owner : options,
        );
      },
    );
    if (accepted) await check;
    else
      await assert.rejects(
        check,
        /different installation|unexpected mount options/,
      );
  }
});

await test("new artifact volumes are created with the bounded tmpfs options", async () => {
  let created = false;
  await ensureOwnedVolume(
    "artifacts",
    "team",
    browserArtifactsVolumeOptions,
    (_command, args) => {
      if (args[1] === "ls") return Promise.resolve("");
      if (args[1] === "create") {
        for (const [key, value] of Object.entries(
          browserArtifactsVolumeOptions,
        ))
          assert.ok(args.includes(`${key}=${value}`));
        created = true;
        return Promise.resolve("artifacts");
      }
      return Promise.resolve(
        args.at(-1)?.includes("clawscarf.installation")
          ? "team"
          : ["local", ...Object.values(browserArtifactsVolumeOptions)].join(
              "|",
            ),
      );
    },
  );
  assert.equal(created, true);
});
