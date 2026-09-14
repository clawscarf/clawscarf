import { RefreshButton } from "../../shared/ui/refresh-button.js";
import { useRef, useState } from "react";
import type { Connection } from "../../../generated/client/types.gen.js";
import { connectionMutationUncertain } from "./mutation-outcome.js";
import { Button } from "../../shared/shadcn/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../shared/shadcn/components/ui/dialog.js";
import { Feedback, Loading, ReadProgress } from "../../shared/ui/feedback.js";
import { ConfirmAction } from "../../shared/ui/confirm-action.js";
import { ConnectionEditor } from "./connection-editor.js";
import { ConnectionSession } from "./connection-session.js";
import { ConnectionsTable } from "./connections-table.js";
import { ConnectorCatalogDialog } from "./connector-catalog-picker.js";
import {
  useCancelConnectionSetup,
  useDisconnectConnection,
  useRefreshConnection,
} from "./connection-mutations.js";
import {
  setupPending,
  useConnections,
  useConnectorCatalog,
  useRefreshConnections,
} from "./connection-queries.js";
import {
  connectionGrantLabel,
  connectionStatus,
  connectorChoice,
} from "./connection-view.js";
import type {
  ConnectionRowActions,
  ConnectionRowView,
  ConnectorAvailability,
  ConnectorChoice,
} from "./presentation.js";

type ConnectionModal =
  | { kind: "catalog" }
  | { kind: "create"; connector: ConnectorChoice }
  | { kind: "edit"; connection: Connection }
  | {
      kind: "setup";
      connection: Connection;
      error?: string;
      reconnect?: boolean;
      setupId?: string;
    }
  | { kind: "disconnect"; connection: Connection };

type RefreshContext = { onRefresh: () => void; refreshing: boolean };

export function ConnectionsPage({
  agentId,
  refreshContext,
}: {
  agentId?: string;
  refreshContext?: RefreshContext | undefined;
}) {
  const collection = useRef<HTMLElement>(null);
  const connections = useConnections();
  const [showDisconnected, setShowDisconnected] = useState(false);
  const catalog = useConnectorCatalog(true);
  const refresh = useRefreshConnections();
  const [refreshing, setRefreshing] = useState(false);
  const refreshPage = () => {
    refreshContext?.onRefresh();
    setRefreshing(true);
    void Promise.all([refresh(), catalog.refetch()]).finally(() =>
      setRefreshing(false),
    );
  };
  const inspect = useRefreshConnection();
  const cancel = useCancelConnectionSetup();
  const [modal, setModal] = useState<ConnectionModal | null>(null);
  const items = connections.data?.pages.flatMap((page) => page.items) ?? [];
  const serviceAvailability = (id: string): ConnectorAvailability =>
    !catalog.isSuccess || catalog.isFetching
      ? "unknown"
      : connectorChoice(id, catalog.data)
        ? "available"
        : "unavailable";
  const canWrite = !connections.error;
  const connectedCounts = new Map<string, number>();
  for (const item of items) {
    if (item.state === "connected")
      connectedCounts.set(
        item.connectorId,
        (connectedCounts.get(item.connectorId) ?? 0) + 1,
      );
  }
  const showSetup = (connection: Connection, reconnect = false) =>
    setModal({
      kind: "setup",
      connection,
      reconnect,
    });
  const rows: ConnectionRowView[] = items
    .filter(
      (connection) =>
        showDisconnected ||
        connection.state !== "disconnected" ||
        connection.cleanup === "needs_attention",
    )
    .map((connection) => {
      const connector = connectorChoice(
        connection.connectorId,
        catalog.data ?? [],
      );
      const actions: ConnectionRowActions = {};
      const available =
        serviceAvailability(connection.connectorId) === "available";
      const active = setupPending(connection);
      const finished = connection.state === "disconnected";
      if (canWrite && !finished) {
        actions.edit = () => setModal({ kind: "edit", connection });
        if (agentId) actions.editLabel = "Change agent access";
      }
      if (canWrite && !finished && !agentId) {
        actions.refresh = () => {
          const uncertain =
            connectionMutationUncertain(inspect.error) &&
            inspect.variables?.connection.id === connection.id;
          inspect.mutate(
            uncertain && inspect.variables
              ? inspect.variables
              : { connection, key: crypto.randomUUID() },
          );
        };
        actions.disconnect = () => setModal({ kind: "disconnect", connection });
        if (active && connection.setup) {
          const setupId = connection.setup.id;
          actions.primary = {
            label: "Continue setup",
            onSelect: () => showSetup(connection),
          };
          actions.cancelSetup = () => {
            const uncertain =
              connectionMutationUncertain(cancel.error) &&
              cancel.variables?.connection.id === connection.id &&
              cancel.variables.setupId === setupId;
            cancel.mutate(
              uncertain && cancel.variables
                ? cancel.variables
                : { connection, setupId, key: crypto.randomUUID() },
            );
          };
        } else if (connection.setup?.state === "outcome_unknown") {
          actions.primary = {
            label: "Check status",
            onSelect: () => showSetup(connection),
          };
        } else if (
          available &&
          (connection.state === "connected" ||
            connection.state === "needs_attention")
        ) {
          actions.reconnect = () => showSetup(connection, true);
        } else if (available) {
          actions.primary = {
            label: connection.setup ? "Start again" : "Connect",
            onSelect: () => showSetup(connection),
          };
        }
      }
      const inspecting = inspect.variables?.connection.id === connection.id;
      const cancelling = cancel.variables?.connection.id === connection.id;
      return {
        id: connection.id,
        name: connection.name,
        connectorId: connection.connectorId,
        connector,
        serviceUnavailable:
          serviceAvailability(connection.connectorId) === "unavailable",
        accountLabel: null,
        grantLabel: agentId
          ? connection.grant.mode === "all" ||
            connection.grant.agentIds.includes(agentId)
            ? "Available"
            : "Not assigned"
          : connectionGrantLabel(connection),
        status: connectionStatus(connection),
        actions,
        busyLabel:
          inspecting && inspect.isPending
            ? "Refreshing…"
            : cancelling && cancel.isPending
              ? "Cancelling…"
              : undefined,
        error:
          inspecting && inspect.error
            ? inspect.error.message
            : cancelling && cancel.error
              ? cancel.error.message
              : (connection.failure?.detail ??
                connection.setup?.failure?.detail),
      };
    });
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    if (!modal) collection.current?.focus();
  };
  return (
    <section
      ref={collection}
      tabIndex={-1}
      aria-label="Connections"
      className="space-y-4 outline-none"
    >
      <ReadProgress active={refreshing} label="Updating connections…" />
      <Feedback error message={connections.error?.message} />
      {catalog.error && !connections.error && (
        <Feedback
          error
          message="Couldn’t load services. Refresh to try again."
        />
      )}
      {connections.isPending ? (
        <Loading label="Loading connections" />
      ) : connections.error && !connections.data ? (
        <RefreshButton
          refreshing={
            refreshing ||
            catalog.isFetching ||
            refreshContext?.refreshing === true
          }
          onRefresh={refreshPage}
        />
      ) : (
        <ConnectionsTable
          items={rows}
          grantHeading={agentId ? "This agent" : "Available to"}
          showDisconnected={showDisconnected}
          onShowDisconnected={setShowDisconnected}
          refreshing={
            refreshing ||
            catalog.isFetching ||
            refreshContext?.refreshing === true
          }
          onRefresh={refreshPage}
          {...(canWrite && !agentId
            ? { onAdd: () => setModal({ kind: "catalog" }) }
            : {})}
          {...(connections.hasNextPage
            ? {
                searchLabel: "Search loaded connections",
                footer: (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={connections.isFetchingNextPage}
                    onClick={() => {
                      void connections.fetchNextPage();
                    }}
                  >
                    {connections.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                ),
              }
            : {})}
        />
      )}
      <ConnectorCatalogDialog
        open={modal?.kind === "catalog"}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
        onCloseAutoFocus={restoreFocus}
        catalog={
          catalog.error
            ? {
                status: "error",
                message: catalog.error.message,
                onRetry: () => {
                  void catalog.refetch();
                },
              }
            : catalog.data
              ? { status: "ready", items: catalog.data }
              : { status: "loading" }
        }
        connectedCounts={connectedCounts}
        disabled={!canWrite}
        onSelect={(connector) => setModal({ kind: "create", connector })}
      />
      <Dialog
        open={!!modal && ["create", "edit", "setup"].includes(modal.kind)}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
          onCloseAutoFocus={restoreFocus}
        >
          <DialogHeader>
            <DialogTitle>
              {modal?.kind === "edit"
                ? agentId
                  ? "Change agent access"
                  : "Edit connection"
                : modal?.kind === "setup"
                  ? "Connect account"
                  : "Add connection"}
            </DialogTitle>
          </DialogHeader>
          {(modal?.kind === "create" || modal?.kind === "edit") && (
            <ConnectionEditor
              key={
                modal.kind === "edit" ? modal.connection.id : modal.connector.id
              }
              grantOnly={!!agentId}
              connector={
                modal.kind === "create"
                  ? modal.connector
                  : connectorChoice(
                      modal.connection.connectorId,
                      catalog.data ?? [],
                    )
              }
              connectorId={
                modal.kind === "create"
                  ? modal.connector.id
                  : modal.connection.connectorId
              }
              serviceAvailability={serviceAvailability(
                modal.kind === "create"
                  ? modal.connector.id
                  : modal.connection.connectorId,
              )}
              {...(modal.kind === "edit"
                ? { connection: modal.connection }
                : { onBack: () => setModal({ kind: "catalog" }) })}
              onSaved={() => setModal(null)}
              onCreated={(connection, error, setupId) =>
                setModal({
                  kind: "setup",
                  connection,
                  ...(error ? { error } : {}),
                  ...(setupId ? { setupId } : {}),
                })
              }
            />
          )}
          {modal?.kind === "setup" && (
            <ConnectionSession
              key={modal.connection.id}
              connection={modal.connection}
              connector={connectorChoice(
                modal.connection.connectorId,
                catalog.data ?? [],
              )}
              serviceAvailability={serviceAvailability(
                modal.connection.connectorId,
              )}
              initialError={modal.error}
              automaticSetupId={modal.setupId}
              reconnect={modal.reconnect ?? false}
              onClose={() => setModal(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      {modal?.kind === "disconnect" && (
        <ConnectionRemovalDialog
          connection={modal.connection}
          onClose={() => setModal(null)}
          onCloseAutoFocus={restoreFocus}
        />
      )}
    </section>
  );
}

function ConnectionRemovalDialog({
  connection,
  onClose,
  onCloseAutoFocus,
}: {
  connection: Connection;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const disconnect = useDisconnectConnection();
  const [key] = useState(() => crypto.randomUUID());
  return (
    <ConfirmAction
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Disconnect ${connection.name}?`}
      description="Agents will lose access to this account. Any pending connection setup will be cancelled."
      confirmLabel="Disconnect"
      pending={disconnect.isPending}
      error={disconnect.error?.message}
      onConfirm={() =>
        disconnect.mutate({ connection, key }, { onSuccess: onClose })
      }
      onCloseAutoFocus={onCloseAutoFocus}
    />
  );
}
