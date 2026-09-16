import { useState } from "react";
import type { Connection } from "../../../generated/types.gen.js";
import { connectionMutationUncertain } from "./mutation-outcome.js";
import { Button } from "../../../../../ui/shadcn/components/ui/button.js";
import { Feedback } from "../../shared/ui/feedback.js";
import { useConnectionAgents } from "./connection-queries.js";
import { ConnectionForm } from "./connection-form.js";
import {
  useCreateConnection,
  useStartConnectionSetup,
  useUpdateConnection,
} from "./connection-mutations.js";
import type {
  ConnectionFormValue,
  ConnectorChoice,
  ConnectorAvailability,
} from "./presentation.js";

export function ConnectionEditor({
  connector,
  connectorId,
  serviceAvailability,
  connection,
  onSaved,
  onCreated,
  onBack,
}: {
  connector: ConnectorChoice | null;
  connectorId: string;
  serviceAvailability: ConnectorAvailability;
  connection?: Connection;
  onSaved: () => void;
  onCreated: (connection: Connection, error?: string, setupId?: string) => void;
  onBack?: () => void;
}) {
  const [selectingAgents, setSelectingAgents] = useState(
    connection?.grant.mode === "selected",
  );
  const agents = useConnectionAgents(selectingAgents);
  const create = useCreateConnection();
  const start = useStartConnectionSetup();
  const update = useUpdateConnection();
  const [createKey] = useState(() => crypto.randomUUID());
  const [setupKey] = useState(() => crypto.randomUUID());
  const [updateKey] = useState(() => crypto.randomUUID());
  const canWrite = !!connection || serviceAvailability === "available";
  const uncertainCreation = connectionMutationUncertain(create.error);
  const uncertainUpdate = connectionMutationUncertain(update.error);
  const submit = (value: ConnectionFormValue) => {
    if (connection) {
      update.mutate(
        { connection, input: value, key: updateKey },
        { onSuccess: onSaved },
      );
      return;
    }
    create.mutate(
      { input: { ...value, connectorId }, key: createKey },
      {
        onSuccess: (created) => {
          start.mutate(
            { connection: created, kind: "initial", key: setupKey },
            {
              onSuccess: (result) => {
                start.reset();
                onCreated(created, undefined, result.setup.id);
              },
              onError: (error) => onCreated(created, error.message),
            },
          );
        },
      },
    );
  };
  return (
    <div className="space-y-4">
      {!connection && serviceAvailability === "unavailable" && (
        <Feedback message="This service is no longer available." />
      )}
      <ConnectionForm
        connector={connector}
        connectorId={connectorId}
        initialValue={
          connection
            ? { name: connection.name, grant: connection.grant }
            : { name: connector?.name ?? connectorId, grant: { mode: "all" } }
        }
        onGrantModeChange={(mode) => setSelectingAgents(mode === "selected")}
        inventory={{
          items: agents.data?.agents ?? [],
          loading: agents.isPending,
          refreshing: agents.isFetching,
          error: agents.error?.message,
          onRefresh: () => {
            void agents.refetch();
          },
        }}
        mode={connection ? "edit" : "create"}
        disabled={!canWrite || uncertainCreation || uncertainUpdate}
        pending={create.isPending || start.isPending || update.isPending}
        error={create.error?.message ?? update.error?.message}
        onSubmit={submit}
        {...(onBack && !uncertainCreation ? { onBack } : {})}
      />
      {uncertainCreation && create.variables && (
        <div className="space-y-3">
          <Feedback message="Check whether the connection was created before starting another." />
          <Button
            type="button"
            variant="outline"
            disabled={create.isPending}
            onClick={() => {
              const previous = create.variables;
              if (!previous) return;
              create.mutate(previous, {
                onSuccess: (created) => onCreated(created),
              });
            }}
          >
            Check creation
          </Button>
        </div>
      )}
      {uncertainUpdate && update.variables && (
        <Button
          type="button"
          variant="outline"
          disabled={update.isPending || !canWrite}
          onClick={() => {
            const previous = update.variables;
            if (previous) update.mutate(previous, { onSuccess: onSaved });
          }}
        >
          Check save
        </Button>
      )}
    </div>
  );
}
