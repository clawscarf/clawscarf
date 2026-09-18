import { randomUUID } from "node:crypto";
import { verifyRuntimeImage } from "./images.js";
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { parseLocalInput } from "./configuration.js";
import {
  readState,
  resourceNames,
  withInstallationLock,
  writePrivate,
} from "./state.js";
import { readUpgrade, snapshotSchema, type Upgrade } from "./upgrade-state.js";
import { runtimeManager } from "./runtime.js";
import { verifyRuntimeBinding } from "./runtime-binding.js";
import { verifyLocalNetworks } from "./networks.js";
import { verifyLocalExecutables } from "./preflight.js";
import { LocalSetupError, run } from "./process.js";

function refuse(detail: string): never {
  throw new LocalSetupError("upgrade_refused", detail);
}
function uncertain(): never {
  throw new LocalSetupError(
    "upgrade_outcome_unknown",
    "The upgrade has an unconfirmed external effect. Inspect its private state and controller before resuming; it will not repeat allocation or deletion.",
  );
}

/** Requires exclusive operator control and the installation's own controller running. */
export async function upgradeLocal(
  directoryInput: string,
  image: string,
  python: string,
  report: (message: string) => void,
  command: typeof run = run,
) {
  const directory = resolve(directoryInput);
  await withInstallationLock(directory, async () => {
    const state = await readState(directory);
    await verifyRuntimeImage(image, command);
    const next = {
      ...state,
      input: parseLocalInput({ ...state.input, runtimeImage: image }),
    };
    const names = resourceNames(state);
    const controller = join(directory, "controller");
    if (Object.keys(process.env).some((key) => key.startsWith("OPENSHELL_")))
      refuse("Unset OPENSHELL_* overrides before upgrading this installation.");
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: join(controller, "config"),
      XDG_STATE_HOME: join(controller, "state"),
      XDG_DATA_HOME: join(controller, "data"),
    };
    await verifyLocalExecutables(state);
    await verifyLocalNetworks(directory, state, command);
    const running = await command("docker", [
      "container",
      "ls",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${names.project}`,
      "--filter",
      "label=com.docker.compose.service=companion",
    ]);
    if (running.trim())
      refuse(
        "Stop the installation and its access companion before upgrading. Start only its private controller.",
      );
    const gate = await command("docker", [
      "image",
      "inspect",
      "--format",
      '{{index .Config.Labels "io.clawscarf.start-gate"}}',
      image,
    ]);
    if (gate.trim() !== "1")
      refuse(
        "The selected exact runtime image does not support the replacement startup gate.",
      );
    const control = runtimeManager(directory, state, env, command);
    let upgrade = await readUpgrade(directory);
    if (
      upgrade?.stage === "complete" &&
      upgrade.toImage === image &&
      state.input.runtimeImage === image
    ) {
      report("This runtime upgrade is already complete.");
      return;
    }
    if (upgrade?.stage === "complete") upgrade = undefined;
    async function rpc(action: string, value: Record<string, unknown> = {}) {
      const response = z
        .discriminatedUnion("ok", [
          z.strictObject({ ok: z.literal(true), value: z.unknown() }),
          z.strictObject({ ok: z.literal(false), code: z.string() }),
        ])
        .parse(
          JSON.parse(
            await command(
              python,
              [fileURLToPath(new URL("./upgrade-rpc.py", import.meta.url))],
              {
                env,
                timeout: 150000,
                input: JSON.stringify({
                  action,
                  controller,
                  name: names.sandbox,
                  ownerId: state.ownerId,
                  ...value,
                }),
              },
            ),
          ),
        );
      if (!response.ok) {
        if (response.code === "global_overrides_unsupported")
          refuse(
            "This controller has global overrides. The pinned API cannot preserve hidden sandbox settings; remove neither compute nor data until that configuration has a supported upgrade path.",
          );
        if (response.code === "policy_not_loaded")
          refuse(
            "The current policy is not confirmed loaded. Reconcile it before upgrading.",
          );
        if (response.code === "runtime_command_unsupported")
          refuse(
            "The runtime uses a custom startup command. Its upgrade needs an explicit supported startup gate.",
          );
        refuse(
          "The controller did not verify the upgrade configuration. Inspect the private upgrade record and current native state before resuming.",
        );
      }
      return response.value;
    }
    async function save(value: Upgrade) {
      await writePrivate(
        join(directory, "upgrade.json"),
        JSON.stringify(value) + "\n",
      );
    }
    if (!upgrade) {
      if (image === state.input.runtimeImage)
        refuse("Choose a different exact runtime image.");
      const records = await control.recorded();
      const target = await control.observe();
      if (
        !target ||
        target.id !== records.receipt?.id ||
        target.phase !== "Stopped"
      )
        refuse(
          "Upgrade requires this installation's recorded runtime to be Stopped.",
        );
      const binding = await verifyRuntimeBinding(state, target, command);
      const snapshot = snapshotSchema.parse(
        await rpc("snapshot", { id: target.id }),
      );
      upgrade = {
        ownerId: state.ownerId,
        generation: randomUUID(),
        fromImage: state.input.runtimeImage,
        toImage: image,
        oldId: target.id,
        oldContainerId: binding.containerId,
        snapshot,
        stage: "prepared",
      };
      await save(upgrade);
    }
    const operation = upgrade;
    if (
      operation.ownerId !== state.ownerId ||
      operation.toImage !== image ||
      ![operation.fromImage, operation.toImage].includes(
        state.input.runtimeImage,
      )
    )
      refuse(
        "Resume the recorded upgrade with its exact image and installation.",
      );
    const advance = async (stage: Upgrade["stage"]) => {
      operation.stage = stage;
      await save(operation);
    };
    const request = () => ({
      snapshot: operation.snapshot,
      id: operation.newId,
    });
    async function retainedVolume() {
      const volume = z
        .object({
          Name: z.literal(names.volume),
          Labels: z.record(z.string(), z.string()),
        })
        .parse(
          JSON.parse(
            await command("docker", [
              "volume",
              "inspect",
              "--format",
              '{"Name":{{json .Name}},"Labels":{{json .Labels}}}',
              names.volume,
            ]),
          ),
        );
      if (volume.Labels["clawscarf.installation"] !== state.ownerId)
        refuse("The retained home volume's ownership changed.");
    }
    async function oldAbsent() {
      if (await control.observe()) uncertain();
      const ids = await command("docker", [
        "container",
        "ls",
        "--all",
        "--quiet",
        "--no-trunc",
        "--filter",
        `id=${operation.oldContainerId}`,
      ]);
      if (ids.trim()) uncertain();
      await retainedVolume();
    }
    if (operation.stage === "prepared") {
      const current = snapshotSchema.parse(
        await rpc("snapshot", { id: operation.oldId }),
      );
      if (!isDeepStrictEqual(current, operation.snapshot))
        refuse(
          "Runtime configuration changed after the upgrade snapshot. No deletion was sent.",
        );
      await verifyRuntimeBinding(
        {
          ...state,
          input: { ...state.input, runtimeImage: operation.fromImage },
        },
        { id: operation.oldId, name: names.sandbox },
        command,
      );
      await advance("delete_sent");
      report("Removing stopped compute; retaining its home volume…");
      // Native deletion has no atomic UUID precondition. Never resend this request.
      try {
        await control.shell(["sandbox", "delete", names.sandbox]);
      } catch {
        /* Reconcile absence below. */
      }
    }
    if (operation.stage === "delete_sent") {
      await oldAbsent();
      await advance("deleted");
    }
    if (operation.stage === "deleted") {
      await oldAbsent();
      await advance("create_sent");
      report("Creating the replacement with application startup gated…");
      try {
        await rpc("create", {
          ...request(),
          image,
          generation: operation.generation,
        });
      } catch {
        /* Observe the unique generation; never replay create. */
      }
    }
    if (operation.stage === "create_sent") {
      const target = await control.observe();
      if (
        !target ||
        target.labels["clawscarf.upgrade"] !== operation.generation ||
        target.id === operation.oldId
      )
        uncertain();
      operation.newId = target.id;
      await advance("created");
    }
    const id = operation.newId ?? uncertain();
    async function confirm() {
      const target = await control.confirm(id);
      if (target.labels["clawscarf.upgrade"] !== operation.generation)
        refuse("The replacement generation changed.");
      return target;
    }
    async function ready() {
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        const target = await confirm();
        if (target.phase === "Ready") return;
        if (["Error", "Stopped"].includes(target.phase))
          refuse(
            "The replacement did not become ready. Inspect the controller before resuming.",
          );
        await delay(500);
      }
      refuse(
        "The replacement is still starting. Resume this same upgrade after inspecting the controller.",
      );
    }
    if (operation.stage === "created") {
      await ready();
      await verifyRuntimeBinding(next, { id, name: names.sandbox }, command);
      await advance("restore_sent");
      report("Restoring the current controller settings…");
    }
    if (operation.stage === "restore_sent") {
      await rpc("restore", request());
      await advance("restored");
    }
    if (operation.stage === "restored") {
      // Next normal startup reads restored settings before launching the application.
      const target = await confirm();
      if (target.phase !== "Stopped")
        await control.shell(["sandbox", "stop", names.sandbox]);
      if ((await confirm()).phase !== "Stopped")
        refuse("The replacement has not confirmed Stopped.");
      await rpc("verify", request());
      await advance("stopped");
    }
    if (operation.stage === "stopped") {
      const binding = await verifyRuntimeBinding(
        next,
        { id, name: names.sandbox },
        command,
      );
      if ((await confirm()).phase !== "Stopped")
        refuse("Keep the replacement stopped until the upgrade commits.");
      const staging = await mkdtemp(
        join(directory, "private", "upgrade-gate-"),
      );
      try {
        const marker = join(staging, "ready");
        await writeFile(marker, operation.generation + "\n", { mode: 0o644 });
        await chmod(marker, 0o644);
        // docker cp assigns root ownership at the container destination. No guest runs here.
        await command("docker", [
          "cp",
          marker,
          `${binding.containerId}:/etc/clawscarf-start-ready`,
        ]);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
      await advance("released");
    }
    if (operation.stage === "released") {
      const target = await confirm();
      if (target.phase !== "Stopped")
        refuse("The upgraded runtime has not confirmed Stopped.");
      await verifyRuntimeBinding(next, { id, name: names.sandbox }, command);
      await advance("committing");
    }
    if (operation.stage === "committing") {
      await confirm();
      await verifyRuntimeBinding(next, { id, name: names.sandbox }, command);
      const intent = { ownerId: state.ownerId, name: names.sandbox, image };
      await writePrivate(
        join(directory, "runtime-create.json"),
        JSON.stringify(intent) + "\n",
      );
      await writePrivate(
        join(directory, "runtime.json"),
        JSON.stringify({ ...intent, id }) + "\n",
      );
      await writePrivate(
        join(directory, "installation.json"),
        JSON.stringify(next, null, 2) + "\n",
      );
      await advance("complete");
    }
    report(
      "Runtime replacement complete; data retained. Stop the private controller, then start the installation to verify native administrator access. This is not a backup or data rollback.",
    );
  });
}
