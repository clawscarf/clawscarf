import {
  ArrowUpRight,
  Check,
  Clock3,
  LoaderCircle,
  Plug,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "../../../../../ui/shadcn/components/ui/button.js";
import { Feedback } from "../../shared/ui/feedback.js";
import { ConnectorLogo } from "./connector-logo.js";
import type { ConnectorChoice } from "./presentation.js";

export type ConnectionSetupView =
  | "not_started"
  | "opening"
  | "pending"
  | "verifying"
  | "expired"
  | "failed"
  | "unknown"
  | "cancelled"
  | "connected";

export function ConnectionSetup({
  connector,
  connectorId,
  serviceUnavailable,
  name,
  state,
  pending,
  error,
  onContinue,
  onRefresh,
  onCancel,
  onStartAgain,
  onDone,
  onStart,
}: {
  connector: ConnectorChoice | null;
  connectorId: string;
  serviceUnavailable: boolean;
  name: string;
  state: ConnectionSetupView;
  pending: boolean;
  error?: string | undefined;
  onContinue?: () => void;
  onRefresh?: () => void;
  onCancel?: () => void;
  onStartAgain?: () => void;
  onDone?: () => void;
  onStart?: () => void;
}) {
  const Icon =
    state === "connected"
      ? Check
      : state === "not_started"
        ? Plug
        : state === "opening" || state === "verifying"
          ? LoaderCircle
          : state === "pending"
            ? Clock3
            : TriangleAlert;
  const label = {
    opening: "Preparing connection…",
    not_started: "Connect your account",
    pending: "Finish connecting your account",
    verifying: "Checking your account…",
    expired: "Connection setup expired",
    failed: "Couldn’t connect this account",
    connected: "Connected",
    unknown: "Connection status is uncertain",
    cancelled: "Connection setup cancelled",
  }[state];
  return (
    <div
      className="min-w-0 space-y-5"
      aria-busy={pending || state === "opening" || state === "verifying"}
    >
      <div className="flex min-w-0 items-center gap-3">
        {connector && <ConnectorLogo iconUrl={connector.iconUrl} />}
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">
            {connector?.name ?? connectorId}
          </p>
        </div>
      </div>
      <div
        className="flex items-center gap-3 rounded-lg border px-4 py-5"
        role="status"
      >
        <Icon
          aria-hidden="true"
          className={
            state === "opening" || state === "verifying"
              ? "size-5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
              : state === "connected"
                ? "size-5 shrink-0 text-success"
                : "size-5 shrink-0 text-muted-foreground"
          }
        />
        <span className="text-sm">{label}</span>
      </div>
      <Feedback error message={error} />
      {serviceUnavailable && (
        <Feedback message="This service is no longer available." />
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel && state !== "connected" && (
          <Button
            type="button"
            variant="ghost"
            className="mr-auto"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel setup
          </Button>
        )}
        {onRefresh &&
          (state === "pending" ||
            state === "verifying" ||
            state === "unknown") && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onRefresh}
            >
              <RefreshCw
                aria-hidden="true"
                className={
                  pending
                    ? "animate-spin motion-reduce:animate-none"
                    : undefined
                }
              />
              Check status
            </Button>
          )}
        {onContinue && state === "pending" && (
          <Button type="button" disabled={pending} onClick={onContinue}>
            Continue setup
            <ArrowUpRight aria-hidden="true" />
          </Button>
        )}
        {onStartAgain &&
          (state === "expired" ||
            state === "failed" ||
            state === "cancelled") && (
            <Button type="button" disabled={pending} onClick={onStartAgain}>
              Start again
            </Button>
          )}
        {onStart && state === "not_started" && (
          <Button type="button" disabled={pending} onClick={onStart}>
            Connect
          </Button>
        )}
        {onDone && state === "connected" && (
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}
