import { once } from "node:events";
import type { Server } from "node:http";

/** One process owns its listeners and closes the composed application exactly once. */
export async function runServer(
  listeners: readonly { server: Server; port: number; host: string }[],
  close: () => Promise<void>,
) {
  let stopping: Promise<void> | undefined;
  const stop = () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    return (stopping ??= Promise.resolve().then(close));
  };
  const onSignal = () => {
    void stop().catch(() => {
      process.exitCode = 1;
    });
  };
  try {
    for (const { server, port, host } of listeners) {
      server.listen(port, host);
      await once(server, "listening");
    }
  } catch (error) {
    await stop();
    throw error;
  }
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return stop;
}
