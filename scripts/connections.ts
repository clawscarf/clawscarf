import { readFile } from "node:fs/promises";
import { type Command } from "commander";
import { randomUUID } from "node:crypto";
import { sessionRequest } from "./session.js";
import * as api from "../services/connections/cloud/generated/sdk.gen.js";
import type { ConnectorAgentGrant } from "../services/connections/cloud/generated/types.gen.js";
import { InstallationError } from "./installation/errors.js";
import { writeResult } from "./output.js";

export function connectionCommands(command: Command, program: Command) {
  command
    .description("Manage connected accounts and their agent access")
    .option("--origin <url>", "Installation origin")
    .option("--session-file <path>", "Private signed-in administrator session");
  const output = (value: unknown, text: string) => {
    writeResult(program, value, text);
  };
  async function request(revision?: number) {
    const base = await sessionRequest(
      command.opts<{ origin?: string; sessionFile?: string }>(),
    );
    return {
      ...base,
      headers: {
        ...base.headers,
        "idempotency-key": randomUUID(),
        "if-match": `"${String(revision ?? 0)}"`,
      },
    };
  }
  const grant = (ids?: string): ConnectorAgentGrant =>
    ids === undefined
      ? { mode: "all" }
      : {
          mode: "selected",
          agentIds: ids
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        };
  command
    .command("list")
    .option("--all", "Include disconnected history")
    .option("--cursor <cursor>", "Continue a previous page")
    .action(async (options: { all?: boolean; cursor?: string }) => {
      const result = (
        await api.listConnections({
          ...(await request()),
          query: {
            limit: 100,
            includeDisconnected: options.all ?? false,
            ...(options.cursor ? { cursor: options.cursor } : {}),
          },
        })
      ).data;
      output(
        result,
        (result.items
          .map((c) => `${c.name} · ${c.state} · ${c.id}`)
          .join("\n") || "No connections.") +
          (result.nextCursor ? `\nMore: --cursor ${result.nextCursor}` : ""),
      );
    });
  command
    .command("catalog")
    .option("--query <text>", "Find a service")
    .option("--cursor <cursor>", "Continue a previous page")
    .action(async (options: { query?: string; cursor?: string }) => {
      const result = (
        await api.listConnectors({
          ...(await request()),
          query: { limit: 100, ...options },
        })
      ).data;
      output(
        result,
        result.items.map((c) => `${c.name} · ${c.id}`).join("\n") +
          (result.nextCursor ? `\nMore: --cursor ${result.nextCursor}` : ""),
      );
    });
  command.command("agents").action(async () => {
    const result = (await api.listConnectionAgents(await request())).data;
    output(result, result.agents.map((a) => a.name ?? a.id).join("\n"));
  });
  command
    .command("add <connectorId>")
    .option("--name <name>", "Connection name")
    .option(
      "--agents <ids>",
      "Comma-separated agent IDs; omitted means all agents",
    )
    .action(
      async (
        connectorId: string,
        options: { name?: string; agents?: string },
      ) => {
        const result = (
          await api.createConnection({
            ...(await request()),
            body: {
              connectorId,
              name: options.name ?? connectorId,
              grant: grant(options.agents),
            },
          })
        ).data;
        output(
          result,
          `${result.name} created · ${result.id}\nUse clawscarf connections connect ${result.id} with the same origin and session.`,
        );
      },
    );
  command
    .command("edit <connectionId>")
    .option("--name <name>", "New name")
    .option("--agents <ids>", "Selected agent IDs")
    .option("--all-agents", "Grant all current and future agents")
    .action(
      async (
        connectionId: string,
        options: { name?: string; agents?: string; allAgents?: boolean },
      ) => {
        if (options.agents !== undefined && options.allAgents)
          throw new InstallationError(
            "invalid_configuration",
            "Choose --agents or --all-agents.",
          );
        const current = (
          await api.getConnection({
            ...(await request()),
            path: { connectionId },
          })
        ).data;
        const result = (
          await api.updateConnection({
            ...(await request(current.revision)),
            path: { connectionId },
            body: {
              name: options.name ?? current.name,
              grant: options.allAgents
                ? { mode: "all" }
                : options.agents === undefined
                  ? current.grant
                  : grant(options.agents),
            },
          })
        ).data;
        output(result, "Connection updated.");
      },
    );
  command
    .command("connect <connectionId>")
    .action(async (connectionId: string) => {
      const current = (
        await api.getConnection({
          ...(await request()),
          path: { connectionId },
        })
      ).data;
      const result =
        current.setup &&
        ["creating", "pending", "verifying"].includes(current.setup.state)
          ? (
              await api.getConnectionSetup({
                ...(await request()),
                path: { connectionId, setupId: current.setup.id },
              })
            ).data
          : (
              await api.startConnectionSetup({
                ...(await request(current.revision)),
                path: { connectionId },
                body: {
                  kind: current.state === "connected" ? "reconnect" : "initial",
                },
              })
            ).data;
      output(
        result,
        result.url
          ? `Continue in your signed-in installation browser:\n${result.url}`
          : `Setup ${result.setup.state}. Refresh before retrying.`,
      );
    });
  command
    .command("complete <connectionId> <setupId>")
    .requiredOption("--receipt-file <path>", "Private OAuth return receipt")
    .action(
      async (
        connectionId: string,
        setupId: string,
        options: { receiptFile: string },
      ) => {
        const result = (
          await api.completeConnectionSetup({
            ...(await request()),
            path: { connectionId, setupId },
            body: {
              sessionUri: (await readFile(options.receiptFile, "utf8")).trim(),
            },
          })
        ).data;
        output(result, "Connection completed.");
      },
    );
  command
    .command("cancel <connectionId> <setupId>")
    .action(async (connectionId: string, setupId: string) => {
      const current = (
        await api.getConnection({
          ...(await request()),
          path: { connectionId },
        })
      ).data;
      const result = (
        await api.cancelConnectionSetup({
          ...(await request(current.revision)),
          path: { connectionId, setupId },
        })
      ).data;
      output(result, "Setup cancelled.");
    });
  command
    .command("disconnect <connectionId>")
    .description("Disconnect an account or remove an inactive entry")
    .action(async (connectionId: string) => {
      const current = (
        await api.getConnection({
          ...(await request()),
          path: { connectionId },
        })
      ).data;
      const result = (
        await api.disconnectConnection({
          ...(await request(current.revision)),
          path: { connectionId },
        })
      ).data;
      output(
        result,
        "Connection removed. Remote account cleanup may still be pending.",
      );
    });
  command
    .command("refresh <connectionId>")
    .action(async (connectionId: string) => {
      const current = (
        await api.getConnection({
          ...(await request()),
          path: { connectionId },
        })
      ).data;
      const result = (
        await api.refreshConnection({
          ...(await request(current.revision)),
          path: { connectionId },
        })
      ).data;
      output(result, `${result.name} · ${result.state}`);
    });
  command.command("usage").action(async () => {
    const result = (await api.getConnectionUsage(await request())).data;
    output(
      result,
      result.limits
        .map(
          (l) =>
            `${l.installation ? "Installation" : "Account"}${l.backend ? ` / ${l.backend}` : ""}: ${String(l.used)}/${String(l.limit)} calls`,
        )
        .join("\n") + `\nResets ${result.resetsAt}`,
    );
  });
}
