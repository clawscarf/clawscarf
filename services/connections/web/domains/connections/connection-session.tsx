import { useEffect, useRef, useState } from "react";
import type { Connection } from "../../../generated/client/types.gen.js";
import { connectionMutationUncertain } from "./mutation-outcome.js";
import { Button } from "../../shared/shadcn/components/ui/button.js";
import { Feedback, Loading } from "../../shared/ui/feedback.js";
import { ConnectionSetup } from "./connection-setup.js";
import {
  useCancelConnectionSetup,
  useRefreshConnection,
  useStartConnectionSetup,
} from "./connection-mutations.js";
import { useConnection, useConnectionHandoff } from "./connection-queries.js";
import {
  canStartConnectionSetup,
  connectionSetupView,
} from "./connection-view.js";
import type { ConnectorChoice, ConnectorAvailability } from "./presentation.js";

export function ConnectionSession({
  connection,
  connector,
  serviceAvailability,
  initialError,
  automaticSetupId,
  onClose,
  reconnect = false,
}: {
  connection: Connection;
  connector: ConnectorChoice | null;
  serviceAvailability: ConnectorAvailability;
  initialError?: string | undefined;
  automaticSetupId?: string | undefined;
  onClose: () => void;
  reconnect?: boolean;
}) {
  const current = useConnection(connection.id);
  const start = useStartConnectionSetup();
  const [handoffId, setHandoffId] = useState(automaticSetupId ?? null);
  const handoff = useConnectionHandoff(connection.id, handoffId);
  const navigated = useRef<string | null>(null);
  useEffect(() => {
    if (
      handoff.data?.url &&
      handoff.data.setup.id === handoffId &&
      navigated.current !== handoffId
    ) {
      navigated.current = handoffId;
      window.location.assign(handoff.data.url);
    }
  }, [handoff.data, handoffId]);
  const cancel = useCancelConnectionSetup();
  const inspect = useRefreshConnection();
  const [dismissedInitial, setDismissedInitial] = useState(false);
  const [initialSetupId] = useState(connection.setup?.id ?? null);
  const observed = current.data;
  const canWrite = true;
  if (current.isPending) return <Loading label="Loading connection" />;
  if (current.error || !observed)
    return (
      <div className="space-y-3">
        <Feedback
          error
          message={current.error?.message ?? "Couldn’t load this connection."}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void current.refetch();
          }}
        >
          Refresh
        </Button>
      </div>
    );
  const setup = observed.setup;
  const pending = start.isPending || cancel.isPending || inspect.isPending;
  const activeSetup =
    !!setup && ["creating", "pending", "verifying"].includes(setup.state);
  const begin = () => {
    setDismissedInitial(true);
    inspect.reset();
    cancel.reset();
    setHandoffId(null);
    const uncertain =
      connectionMutationUncertain(start.error) &&
      observed.setup?.id === start.variables?.connection.setup?.id;
    const intent =
      uncertain && start.variables
        ? start.variables
        : {
            connection: observed,
            key: crypto.randomUUID(),
            kind:
              reconnect ||
              observed.state === "connected" ||
              observed.state === "needs_attention"
                ? ("reconnect" as const)
                : ("initial" as const),
          };
    start.mutate(intent, {
      onSuccess: (result) => {
        setHandoffId(result.setup.id);
        start.reset();
        void current.refetch();
      },
    });
  };
  const starting = start.isPending || (!!handoffId && setup?.id !== handoffId);
  const state = starting
    ? "opening"
    : reconnect &&
        !activeSetup &&
        setup?.state === "succeeded" &&
        setup.id === initialSetupId
      ? "not_started"
      : connectionSetupView(observed);
  const inspectionConfirmed =
    state === "connected" &&
    setup?.id === inspect.variables?.connection.setup?.id;
  return (
    <ConnectionSetup
      connector={connector}
      connectorId={observed.connectorId}
      serviceUnavailable={serviceAvailability === "unavailable"}
      name={observed.name}
      state={state}
      pending={pending}
      error={
        (inspectionConfirmed ? undefined : inspect.error?.message) ??
        start.error?.message ??
        handoff.error?.message ??
        cancel.error?.message ??
        (starting ? undefined : setup?.failure?.detail) ??
        (starting || activeSetup ? undefined : observed.failure?.detail) ??
        (dismissedInitial ? undefined : initialError)
      }
      {...(canWrite &&
      serviceAvailability === "available" &&
      canStartConnectionSetup(observed)
        ? { onStart: begin, onStartAgain: begin }
        : {})}
      {...(canWrite && setup?.state === "pending"
        ? {
            onContinue: () => {
              setDismissedInitial(true);
              navigated.current = null;
              if (handoffId === setup.id) void handoff.refetch();
              else setHandoffId(setup.id);
            },
          }
        : {})}
      {...(canWrite && activeSetup && setup
        ? {
            onCancel: () => {
              setHandoffId(null);
              const uncertain =
                connectionMutationUncertain(cancel.error) &&
                cancel.variables?.setupId === setup.id;
              cancel.mutate(
                uncertain && cancel.variables
                  ? cancel.variables
                  : {
                      connection: observed,
                      setupId: setup.id,
                      key: crypto.randomUUID(),
                    },
                { onSuccess: onClose },
              );
            },
          }
        : {})}
      onRefresh={() => {
        setDismissedInitial(true);
        if (handoffId && state !== "connected" && state !== "verifying") {
          void handoff.refetch();
          void current.refetch();
          return;
        }
        if (!canWrite) {
          void current.refetch();
          return;
        }
        const uncertain = connectionMutationUncertain(inspect.error);
        inspect.mutate(
          uncertain && inspect.variables
            ? inspect.variables
            : { connection: observed, key: crypto.randomUUID() },
          { onSuccess: () => inspect.reset() },
        );
      }}
      onDone={onClose}
    />
  );
}
