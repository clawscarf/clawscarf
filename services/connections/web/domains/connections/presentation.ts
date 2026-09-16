import type { ConnectorAgentGrant } from "../../../generated/client/types.gen.js";

export interface ConnectorChoice {
  id: string;
  name: string;
  description: string;
  category: string;
  iconUrl: string | null;
}

export type ConnectionAgentGrant = ConnectorAgentGrant;
export type ConnectorAvailability = "available" | "unavailable" | "unknown";

export interface ConnectionAgentChoice {
  id: string;
  name: string | null;
}

export interface ConnectionFormValue {
  name: string;
  grant: ConnectionAgentGrant;
}

export interface ConnectionRowActions {
  edit?: () => void;
  refresh?: () => void;
  reconnect?: () => void;
  disconnect?: () => void;
  cancelSetup?: () => void;
  primary?: {
    label: "Connect" | "Continue setup" | "Start again" | "Check status";
    onSelect: () => void;
  };
}

export interface ConnectionRowView {
  id: string;
  name: string;
  connectorId: string;
  connector: ConnectorChoice | null;
  serviceUnavailable: boolean;
  grantLabel: string;
  status: {
    label: string;
    tone: "neutral" | "success" | "warning" | "danger";
  };
  actions: ConnectionRowActions;
  busyLabel?: string | undefined;
  error?: string | undefined;
}
