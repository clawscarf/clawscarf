import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

/** The external operator releases a replacement only after restoring its controller settings. */
export async function waitForStartGate(
  id: string,
  read: () => Promise<string> = () =>
    readFile("/etc/clawscarf-start-ready", "utf8"),
  wait: () => Promise<void> = () => delay(1000),
) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))
    throw Error("Invalid runtime startup gate.");
  for (;;) {
    try {
      if ((await read()).trim() === id) return;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    await wait();
  }
}
