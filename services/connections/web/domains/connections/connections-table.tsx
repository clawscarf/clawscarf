import { Checkbox } from "../../shared/shadcn/components/ui/checkbox.js";
import { RefreshButton } from "../../shared/ui/refresh-button.js";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Unplug,
  X,
} from "lucide-react";
import { Badge } from "../../shared/shadcn/components/ui/badge.js";
import { Button } from "../../shared/shadcn/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../shared/shadcn/components/ui/dropdown-menu.js";
import {
  TableCell,
  TableHead,
  TableRow,
} from "../../shared/shadcn/components/ui/table.js";
import { CollectionTable } from "../../shared/ui/collection-table.js";
import { cn } from "../../shared/shadcn/lib/utils.js";
import { ConnectorLogo } from "./connector-logo.js";
import type { ConnectionRowView } from "./presentation.js";

const statusColors = {
  neutral: "text-muted-foreground",
  success: "border-success/25 bg-success/5 text-success",
  warning: "border-warning/25 bg-warning/5 text-warning",
  danger: "border-destructive/25 bg-destructive/5 text-destructive",
};

export function ConnectionsTable({
  items,
  grantHeading = "Available to",
  refreshing,
  onRefresh,
  onAdd,
  accountAction,
  footer,
  searchLabel,
  showDisconnected,
  onShowDisconnected,
}: {
  items: readonly ConnectionRowView[];
  grantHeading?: string;
  refreshing: boolean;
  onRefresh: () => void;
  onAdd?: () => void;
  accountAction?: ReactNode;
  footer?: ReactNode;
  searchLabel?: string;
  showDisconnected: boolean;
  onShowDisconnected: (value: boolean) => void;
}) {
  return (
    <CollectionTable
      label="Connections"
      items={items}
      columns={4}
      searchText={(item) =>
        `${item.name} ${item.connector?.name ?? item.connectorId} ${item.accountLabel ?? ""}`
      }
      empty="No connections yet."
      footer={
        <>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={showDisconnected}
              onCheckedChange={(value) => onShowDisconnected(value === true)}
            />
            Show disconnected
          </label>
          {footer}
        </>
      }
      {...(searchLabel ? { searchLabel } : {})}
      actions={
        <div className="flex items-center gap-2">
          <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
          {accountAction}
          {onAdd && (
            <Button type="button" onClick={onAdd}>
              <Plus aria-hidden="true" />
              Add connection
            </Button>
          )}
        </div>
      }
      headers={
        <>
          <TableHead>Connection</TableHead>
          <TableHead className="hidden md:table-cell">{grantHeading}</TableHead>
          <TableHead className="hidden md:table-cell">Status</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">Actions</span>
          </TableHead>
        </>
      }
      renderRow={(connection) => (
        <ConnectionRow key={connection.id} connection={connection} />
      )}
    />
  );
}

function ConnectionRow({ connection }: { connection: ConnectionRowView }) {
  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <div className="flex min-w-0 items-start gap-3 py-1">
          {connection.connector && (
            <ConnectorLogo iconUrl={connection.connector.iconUrl} />
          )}
          <div className="min-w-0 max-w-[13rem] sm:max-w-xs">
            <p className="break-words font-medium">{connection.name}</p>
            <p className="break-words text-xs text-muted-foreground">
              {connection.connector?.name ?? connection.connectorId}
              {connection.accountLabel && ` · ${connection.accountLabel}`}
              {connection.serviceUnavailable && " · Service unavailable"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground md:hidden">
              {connection.grantLabel}
            </p>
            <div className="mt-2 space-y-2 md:hidden">
              <ConnectionStatus connection={connection} />
              <ConnectionPrimaryAction connection={connection} />
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="block max-w-48 break-words text-sm">
          {connection.grantLabel}
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <ConnectionStatus connection={connection} />
      </TableCell>
      <TableCell className="text-right align-top md:align-middle">
        <ConnectionActions connection={connection} />
      </TableCell>
    </TableRow>
  );
}

function ConnectionStatus({ connection }: { connection: ConnectionRowView }) {
  return (
    <>
      {connection.busyLabel ? (
        <span
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
        >
          <LoaderCircle
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
          {connection.busyLabel}
        </span>
      ) : (
        <Badge
          variant="outline"
          className={cn(
            "whitespace-nowrap",
            statusColors[connection.status.tone],
          )}
        >
          {connection.status.label}
        </Badge>
      )}
      {connection.error && (
        <p
          role="alert"
          className="mt-2 max-w-xs whitespace-normal break-words text-xs text-destructive"
        >
          {connection.error}
        </p>
      )}
    </>
  );
}

function ConnectionPrimaryAction({
  connection,
}: {
  connection: ConnectionRowView;
}) {
  const pending = !!connection.busyLabel;
  const action = connection.actions.primary;
  if (action)
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={action.onSelect}
      >
        {action.label}
        {action.label === "Continue setup" && (
          <ArrowUpRight aria-hidden="true" />
        )}
      </Button>
    );
  return null;
}

function ConnectionActions({ connection }: { connection: ConnectionRowView }) {
  const { actions } = connection;
  const pending = !!connection.busyLabel;
  const hasMenu = !!(
    actions.edit ||
    actions.refresh ||
    actions.reconnect ||
    actions.cancelSetup ||
    actions.disconnect
  );
  const hasRegularActions = !!(
    actions.edit ||
    actions.refresh ||
    actions.reconnect
  );
  const hasDestructiveActions = !!(actions.cancelSetup || actions.disconnect);
  return (
    <div className="flex flex-nowrap items-center justify-end gap-2">
      <div className="hidden md:block">
        <ConnectionPrimaryAction connection={connection} />
      </div>
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Actions for ${connection.name}`}
              disabled={pending}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {actions.edit && (
              <DropdownMenuItem onSelect={actions.edit}>
                <Pencil aria-hidden="true" />
                {actions.editLabel ?? "Edit connection"}
              </DropdownMenuItem>
            )}
            {actions.refresh && (
              <DropdownMenuItem onSelect={actions.refresh}>
                <RefreshCw aria-hidden="true" />
                Refresh
              </DropdownMenuItem>
            )}
            {actions.reconnect && (
              <DropdownMenuItem onSelect={actions.reconnect}>
                <ArrowUpRight aria-hidden="true" />
                Reconnect
              </DropdownMenuItem>
            )}
            {hasRegularActions && hasDestructiveActions && (
              <DropdownMenuSeparator />
            )}
            {actions.cancelSetup && (
              <DropdownMenuItem onSelect={actions.cancelSetup}>
                <X aria-hidden="true" />
                Cancel setup
              </DropdownMenuItem>
            )}
            {actions.disconnect && (
              <DropdownMenuItem
                variant="destructive"
                onSelect={actions.disconnect}
              >
                <Unplug aria-hidden="true" />
                Disconnect
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
