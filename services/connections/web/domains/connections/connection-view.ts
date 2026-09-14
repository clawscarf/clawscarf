import type { Connection } from "../../../generated/client/types.gen.js";
import type { ConnectionSetupView } from "./connection-setup.js";
import type { ConnectionRowView, ConnectorChoice } from "./presentation.js";

export function connectorChoice(
  id: string,
  catalog: readonly ConnectorChoice[],
): ConnectorChoice | null {
  return catalog.find((item) => item.id === id) ?? null;
}

export function connectionGrantLabel(connection: Connection): string {
  return connection.grant.mode === "all"
    ? "All agents"
    : `${connection.grant.agentIds.length} selected ${connection.grant.agentIds.length === 1 ? "agent" : "agents"}`;
}

export function connectionStatus(
  connection: Connection,
): ConnectionRowView["status"] {
  if (connection.state === "disconnected") {
    if (connection.cleanup === "needs_attention")
      return { label: "Removal needs attention", tone: "warning" };
    if (connection.cleanup === "pending")
      return { label: "Disconnecting", tone: "neutral" };
    return { label: "Disconnected", tone: "neutral" };
  }
  const setup = connection.setup;
  if (setup && ["creating", "pending", "verifying"].includes(setup.state))
    return {
      label: setup.kind === "reconnect" ? "Reconnect pending" : "Setup pending",
      tone: "neutral",
    };
  if (setup?.state === "outcome_unknown")
    return { label: "Needs attention", tone: "warning" };
  if (connection.state === "connected")
    return { label: "Connected", tone: "success" };
  if (connection.state === "needs_attention")
    return { label: "Needs attention", tone: "warning" };
  if (setup?.state === "expired")
    return { label: "Setup expired", tone: "warning" };
  return { label: "Not connected", tone: "neutral" };
}

export function connectionSetupView(
  connection: Connection,
): ConnectionSetupView {
  const state = connection.setup?.state;
  if (!state) return "not_started";
  switch (state) {
    case "creating":
      return "opening";
    case "pending":
      return "pending";
    case "verifying":
      return "verifying";
    case "succeeded":
      return "connected";
    case "outcome_unknown":
      return "unknown";
    case "expired":
      return "expired";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
  }
}

export function canStartConnectionSetup(connection: Connection) {
  const setup = connection.setup;
  return (
    connection.state !== "disconnected" &&
    (!setup ||
      ["expired", "cancelled", "failed", "succeeded"].includes(setup.state))
  );
}
