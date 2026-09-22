import type { Command } from "commander";
import packageInfo from "../package.json" with { type: "json" };
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PostHog } from "posthog-node";
import { Agent, fetch } from "undici";
import { z } from "zod";

const destinationSchema = z.strictObject({
  host: z.url().refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && url.hostname === "127.0.0.1"))
    );
  }),
  projectToken: z.string().regex(/^phc_[A-Za-z0-9_-]+$/),
});

// Deliberately finite: remote errors and OperatorError.code can contain arbitrary text.
const errorCodeSchema = z.enum([
  "invalid_configuration",
  "unsupported_platform",
  "release_mismatch",
  "stale_plan",
  "change_unsupported",
  "unavailable",
  "operation_failed",
  "invalid_arguments",
  "operation_busy",
  "invalid_team_configuration",
  "runtime_binding_changed",
  "runtime_binding_unavailable",
  "administrator_unverified",
  "bootstrap_outcome_unknown",
  "browser_unavailable",
  "command_failed",
  "configuration_changed",
  "database_start_failed",
  "executable_unavailable",
  "incomplete_certificate",
  "invalid_certificate",
  "invalid_model_setup",
  "model_credential_pending",
  "invalid_connections_setup",
  "connections_catalog_blocked",
  "connections_configuration_pending",
  "connections_configuration_refused",
  "connections_configuration_unavailable",
  "invalid_runtime_policy",
  "native_unavailable",
  "network_identity_changed",
  "network_lookup_incomplete",
  "network_outcome_unknown",
  "network_unprepared",
  "platform_unqualified",
  "port_check_failed",
  "port_in_use",
  "private_directory_required",
  "runtime_failed",
  "runtime_identity_changed",
  "runtime_lookup_incomplete",
  "runtime_outcome_unknown",
  "runtime_start_failed",
  "runtime_stop_pending",
  "startup_interrupted",
  "startup_timed_out",
  "unowned_directory",
  "ownership_conflict",
  "runtime_credentials_changed",
  "database_setup_failed",
  "outcome_unknown",
  "unauthorized",
  "forbidden",
  "ENOENT",
  "ENOTDIR",
  "EACCES",
  "EPERM",
  "EEXIST",
  "ELOOP",
  "ENOSPC",
]);

export interface CommandObservation {
  configurationMode(mode: "new" | "edit"): void;
  result(value: unknown): void;
}

type Outcome = "success" | "failure" | "cancelled" | "action_required";
type ConfigurationOutcome = "saved" | "unchanged" | "ready";

/** One CLI invocation. No runtime, server, browser, or automatic exception instrumentation. */
export class CliTelemetry implements CommandObservation {
  private client: PostHog | undefined;
  private dispatcher: Agent | undefined;
  private started: Promise<void> | undefined;
  private startTime = 0;
  private distinctId = "";
  private command = "";
  private action: "stop" | "delete" | undefined;
  private interactive = false;
  private version = "";
  private readonly invocationId = randomUUID();
  private outcome: Outcome = "success";
  private mode: "new" | "edit" | undefined;
  private configuration: ConfigurationOutcome | undefined;

  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly destinationFile: URL = new URL(
      "../release/telemetry.json",
      import.meta.url,
    ),
  ) {}

  async start(command: Command): Promise<void> {
    if (this.environment.CLAWSCARF_TELEMETRY_DISABLED === "1") return;
    try {
      const destination = destinationSchema
        .nullable()
        .parse(JSON.parse(await readFile(this.destinationFile, "utf8")));
      if (!destination) return;
      const manifest = z
        .object({
          version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
        })
        .parse(packageInfo);
      this.version = manifest.version;
      const directory = join(
        this.environment.XDG_CONFIG_HOME || homedir(),
        this.environment.XDG_CONFIG_HOME ? "clawscarf" : ".config/clawscarf",
      );
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = join(directory, "telemetry-id");
      try {
        const handle = await open(file, "wx", 0o600);
        try {
          await handle.writeFile(randomUUID() + "\n");
        } finally {
          await handle.close();
        }
        process.stderr.write(
          "ClawScarf reports CLI usage and failure codes to PostHog. Disable with CLAWSCARF_TELEMETRY_DISABLED=1. Details: https://github.com/clawscarf/clawscarf/blob/main/deploy/deployment/installation.md#telemetry\n",
        );
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ))
          throw error;
      }
      // A concurrent creator may still be writing. Skip this invocation if incomplete.
      this.distinctId = z.uuid().parse((await readFile(file, "utf8")).trim());
      const names: string[] = [];
      for (
        let current: Command | null = command;
        current.parent;
        current = current.parent
      )
        names.unshift(current.name());
      this.command = names.join(" ");
      const options = command.optsWithGlobals<{
        nonInteractive?: boolean;
        delete?: boolean;
      }>();
      this.interactive =
        [process.stdin.isTTY, process.stdout.isTTY].every((isTTY) => isTTY) &&
        !options.nonInteractive;
      if (this.command === "stop")
        this.action = options.delete ? "delete" : "stop";
      const dispatcher = new Agent({ connect: { timeout: 500 } });
      this.dispatcher = dispatcher;
      this.client = new PostHog(destination.projectToken, {
        host: destination.host,
        isServer: false,
        disableGeoip: true,
        enableExceptionAutocapture: false,
        enableLocalEvaluation: false,
        flushInterval: 0,
        fetchRetryCount: 0,
        requestTimeout: 500,
        disableCompression: true,
        fetch: async (url, options) => {
          // Only uncompressed event JSON is supported; never follow ingestion redirects.
          if (typeof options.body !== "string")
            throw Error("Expected event JSON");
          const response = await fetch(url, {
            method: options.method,
            headers: options.headers,
            body: options.body,
            dispatcher,
            redirect: "error",
            signal: AbortSignal.timeout(500),
          });
          const body = await response.text();
          return {
            status: response.status,
            headers: response.headers,
            text: () => Promise.resolve(body),
            json: (): Promise<unknown> =>
              Promise.resolve().then((): unknown => JSON.parse(body)),
          };
        },
      });
      this.startTime = performance.now();
      this.started = this.capture("cli_command_started");
    } catch {
      // Telemetry configuration/storage must never prevent a command from running.
      await this.dispatcher?.destroy().catch(() => {});
      this.client = undefined;
    }
  }

  configurationMode(mode: "new" | "edit"): void {
    this.mode = mode;
  }

  result(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if ("state" in value && value.state === "cancelled")
      this.outcome = "cancelled";
    else if ("state" in value && value.state === "action_required")
      this.outcome = "action_required";
    else if (this.command === "configure" || this.command === "start") {
      if ("ready" in value && value.ready === false)
        this.outcome = "action_required";
    }
    if (this.command !== "configure") return;
    if ("ready" in value && value.ready === true) this.configuration = "ready";
    else if ("state" in value && value.state === "unchanged")
      this.configuration = "unchanged";
    else if ("state" in value && value.state === "prepared")
      this.configuration = "saved";
  }

  async finish(
    exitCode: string | number | null | undefined,
    failureCode?: string,
  ): Promise<void> {
    if (!this.client) return;
    const outcome =
      exitCode === 130 || failureCode === "cancelled"
        ? "cancelled"
        : failureCode !== undefined ||
            (exitCode !== undefined && Number(exitCode) !== 0)
          ? "failure"
          : this.outcome;
    const code = errorCodeSchema.safeParse(failureCode);
    try {
      await Promise.all([
        this.started,
        this.capture("cli_command_finished", {
          outcome,
          duration_ms: Math.round(performance.now() - this.startTime),
          ...(outcome === "failure"
            ? {
                error_code: code.success ? code.data : "operation_failed",
                operation: this.command,
              }
            : {}),
          ...(this.mode ? { configuration_mode: this.mode } : {}),
          ...(this.configuration
            ? { configuration_outcome: this.configuration }
            : {}),
        }),
      ]);
      await this.client.shutdown(1000);
    } catch {
      // Best effort only: no retries, offline queue, output, or changed exit status.
    } finally {
      await this.dispatcher?.destroy().catch(() => {});
      this.client = undefined;
    }
  }

  private async capture(
    event: "cli_command_started" | "cli_command_finished",
    result: {
      outcome?: Outcome;
      duration_ms?: number;
      error_code?: string;
      operation?: string;
      configuration_mode?: "new" | "edit";
      configuration_outcome?: ConfigurationOutcome;
    } = {},
  ): Promise<void> {
    try {
      await this.client?.captureImmediate({
        distinctId: this.distinctId,
        event,
        timestamp: new Date(),
        properties: {
          command: this.command,
          invocation_id: this.invocationId,
          cli_version: this.version,
          os: process.platform,
          architecture: process.arch,
          interactive: this.interactive,
          ...(this.action ? { action: this.action } : {}),
          ...result,
          $process_person_profile: false,
          $ip: null,
        },
      });
    } catch {
      // Never forward telemetry errors (including remote response bodies) to output.
    }
  }
}
