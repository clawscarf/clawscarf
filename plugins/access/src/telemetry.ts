import { isSilentReplyText } from "openclaw/plugin-sdk/reply-chunking";
import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";

/** Observe metadata from public hooks; never retain prompts, output, or session IDs. */
export class ActivationTelemetry {
  private readonly responses = new Map<string, number>();
  constructor(
    private readonly environment: () => Record<string, string | undefined>,
    private readonly directory: string,
  ) {}

  response(
    event: { runId: string; assistantTexts: readonly string[] },
    context: { inputProvenance?: { kind: string } },
  ) {
    this.responses.delete(event.runId);
    if (this.environment().CLAWSCARF_TELEMETRY_DISABLED === "1") return;
    if (
      context.inputProvenance?.kind !== "external_user" ||
      !event.assistantTexts.some(
        (text) => text.trim() && !isSilentReplyText(text),
      )
    )
      return;
    // Hooks for interrupted runs may never finish. Bound metadata retained in memory.
    const now = Date.now();
    for (const [id, time] of this.responses)
      if (now - time >= 3600000) this.responses.delete(id);
    if (this.responses.size < 128) this.responses.set(event.runId, now);
  }

  async finished(event: { runId?: string | undefined; success: boolean }) {
    if (!event.runId || !this.responses.delete(event.runId) || !event.success)
      return;
    const env = this.environment();
    if (env.CLAWSCARF_TELEMETRY_DISABLED === "1") return;
    try {
      const id = env.CLAWSCARF_TELEMETRY_INSTALLATION_ID;
      const token = env.CLAWSCARF_TELEMETRY_PROJECT_TOKEN;
      const host = new URL(env.CLAWSCARF_TELEMETRY_HOST ?? "");
      if (
        !id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          id,
        ) ||
        !token ||
        !/^phc_[A-Za-z0-9_-]+$/.test(token)
      )
        return;
      if (
        host.username ||
        host.password ||
        host.search ||
        host.hash ||
        host.pathname !== "/" ||
        !(
          host.origin === "https://eu.i.posthog.com" ||
          (host.protocol === "http:" && host.hostname === "127.0.0.1")
        )
      )
        return;
      // Claim before delivery. Crashes or failed delivery can undercount, never turn
      // a later conversation into the first response or count concurrent runs twice.
      const file = await open(
        join(this.directory, `clawscarf-activation-${id}.json`),
        "wx",
        0o600,
      );
      const timestamp = new Date().toISOString();
      const insertId = randomUUID();
      try {
        await file.writeFile(JSON.stringify({ timestamp, insertId }));
      } finally {
        await file.close();
      }
      const result = await fetch(new URL("/batch/", host), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(500),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: token,
          batch: [
            {
              event: "first_agent_response",
              distinct_id: `installation:${id}`,
              timestamp,
              properties: {
                source: "product",
                installation_id: id,
                $insert_id: insertId,
                $process_person_profile: false,
                $geoip_disable: true,
                $ip: null,
              },
            },
          ],
        }),
      });
      await result.body?.cancel();
    } catch {
      /* Analytics must never fail a response or disclose network errors. */
    }
  }
}
