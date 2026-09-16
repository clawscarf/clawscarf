import { useId, useState } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { Button } from "../../../../../ui/shadcn/components/ui/button.js";
import { Input } from "../../../../../ui/shadcn/components/ui/input.js";
import { Feedback } from "../../shared/ui/feedback.js";
import { FormField } from "../../shared/ui/form-field.js";
import {
  ConnectionAgentPicker,
  type ConnectionAgentInventory,
} from "./connection-agent-picker.js";
import { ConnectorLogo } from "./connector-logo.js";
import type { ConnectorChoice, ConnectionFormValue } from "./presentation.js";

export function ConnectionForm({
  connector,
  connectorId,
  initialValue,
  inventory,
  mode,
  disabled,
  pending,
  error,
  onSubmit,
  onGrantModeChange,
  onBack,
}: {
  connector: ConnectorChoice | null;
  connectorId: string;
  initialValue: ConnectionFormValue;
  inventory: ConnectionAgentInventory;
  mode: "create" | "edit";
  disabled: boolean;
  pending: boolean;
  error?: string | undefined;
  onSubmit: (value: ConnectionFormValue) => void;
  onGrantModeChange?: (mode: ConnectionFormValue["grant"]["mode"]) => void;
  onBack?: () => void;
}) {
  const errorId = useId();
  const [value, setValue] = useState(initialValue);
  const [submitted, setSubmitted] = useState(false);
  const nameMissing = submitted && !value.name.trim();
  const agentsMissing =
    submitted &&
    value.grant.mode === "selected" &&
    !value.grant.agentIds.length;
  const unavailable =
    disabled ||
    pending ||
    (value.grant.mode === "selected" &&
      (inventory.loading || !!inventory.error));

  return (
    <form
      className="min-w-0 space-y-5"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (unavailable) return;
        setSubmitted(true);
        if (
          !value.name.trim() ||
          (value.grant.mode === "selected" && !value.grant.agentIds.length)
        )
          return;
        onSubmit({ ...value, name: value.name.trim() });
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {connector && <ConnectorLogo iconUrl={connector.iconUrl} />}
        <span className="min-w-0 break-words text-sm font-medium">
          {connector?.name ?? connectorId}
        </span>
      </div>
      <FormField label="Name">
        {(props) => (
          <Input
            {...props}
            name="name"
            autoComplete="off"
            required
            maxLength={160}
            disabled={disabled || pending}
            aria-invalid={nameMissing || undefined}
            aria-describedby={nameMissing ? `${errorId}-name` : undefined}
            value={value.name}
            onChange={(event) =>
              setValue({ ...value, name: event.target.value })
            }
          />
        )}
      </FormField>
      {nameMissing && (
        <p
          id={`${errorId}-name`}
          role="alert"
          className="text-sm text-destructive"
        >
          Enter a connection name.
        </p>
      )}
      <ConnectionAgentPicker
        value={value.grant}
        onChange={(grant) => {
          setValue({ ...value, grant });
          onGrantModeChange?.(grant.mode);
        }}
        inventory={inventory}
        disabled={disabled || pending}
        error={agentsMissing ? "Select at least one agent." : undefined}
      />
      <Feedback error message={error} />
      <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
        {onBack && (
          <Button
            type="button"
            className="mr-auto"
            variant="ghost"
            disabled={pending}
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" />
            Back
          </Button>
        )}
        <Button type="submit" disabled={unavailable}>
          {pending && (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          )}
          {pending
            ? mode === "create"
              ? "Connecting…"
              : "Saving…"
            : mode === "create"
              ? "Connect"
              : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
