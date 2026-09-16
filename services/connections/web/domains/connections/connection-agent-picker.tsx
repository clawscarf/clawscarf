import { useId, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "../../../../../ui/shadcn/components/ui/button.js";
import { Checkbox } from "../../../../../ui/shadcn/components/ui/checkbox.js";
import { Input } from "../../../../../ui/shadcn/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../../ui/shadcn/components/ui/select.js";
import { FormField } from "../../shared/ui/form-field.js";
import { Feedback, Loading, ReadProgress } from "../../shared/ui/feedback.js";
import type {
  ConnectionAgentChoice,
  ConnectionAgentGrant,
} from "./presentation.js";

export interface ConnectionAgentInventory {
  items: readonly ConnectionAgentChoice[];
  loading: boolean;
  refreshing: boolean;
  error?: string | undefined;
  onRefresh: () => void;
}

export function ConnectionAgentPicker({
  value,
  onChange,
  inventory,
  disabled,
  error,
}: {
  value: ConnectionAgentGrant;
  onChange: (grant: ConnectionAgentGrant) => void;
  inventory: ConnectionAgentInventory;
  disabled: boolean;
  error?: string | undefined;
}) {
  const groupId = useId();
  const [search, setSearch] = useState("");
  const selectedIds = value.mode === "selected" ? value.agentIds : [];
  const byId = new Map(inventory.items.map((agent) => [agent.id, agent]));
  const choices = [...byId.keys(), ...selectedIds.filter((id) => !byId.has(id))]
    .map((id) => ({
      id,
      name: byId.get(id)?.name ?? id,
      missing: !byId.has(id) && !inventory.loading && !inventory.error,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const query = search.trim().toLocaleLowerCase();
  const matches = choices.filter((agent) =>
    `${agent.name} ${agent.id}`.toLocaleLowerCase().includes(query),
  );
  const readUnavailable = inventory.loading || !!inventory.error;
  return (
    <div className="min-w-0 space-y-3">
      <FormField label="Available to">
        {(props) => (
          <Select
            disabled={disabled}
            value={value.mode}
            onValueChange={(mode) => {
              if (mode === "all") onChange({ mode: "all" });
              if (mode === "selected")
                onChange({ mode: "selected", agentIds: [] });
            }}
          >
            <SelectTrigger {...props} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All current and future agents</SelectItem>
              <SelectItem value="selected">Selected agents</SelectItem>
            </SelectContent>
          </Select>
        )}
      </FormField>
      {value.mode === "selected" && (
        <>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-9"
                type="search"
                aria-label="Search agents"
                placeholder="Search agents"
                disabled={disabled || readUnavailable}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Refresh agents"
              disabled={disabled || inventory.refreshing || inventory.loading}
              onClick={inventory.onRefresh}
            >
              <RefreshCw
                aria-hidden="true"
                className={
                  inventory.refreshing
                    ? "animate-spin motion-reduce:animate-none"
                    : undefined
                }
              />
            </Button>
          </div>
          {inventory.loading && (
            <Loading label="Loading agents from OpenClaw…" />
          )}
          <ReadProgress
            active={!inventory.loading && inventory.refreshing}
            label="Updating agents from OpenClaw…"
          />
          <Feedback error message={inventory.error} />
          {!inventory.loading && (
            <div
              role="group"
              aria-label="Available agents"
              aria-busy={inventory.refreshing}
              aria-describedby={error ? `${groupId}-error` : undefined}
              className="max-h-52 overflow-y-auto rounded-lg border p-1"
            >
              {matches.map((agent) => (
                <label
                  key={agent.id}
                  className="flex min-h-10 min-w-0 items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent"
                >
                  <Checkbox
                    disabled={disabled || readUnavailable}
                    checked={selectedIds.includes(agent.id)}
                    onCheckedChange={(checked) =>
                      onChange({
                        mode: "selected",
                        agentIds:
                          checked === true
                            ? [...selectedIds, agent.id]
                            : selectedIds.filter((id) => id !== agent.id),
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 break-words">
                    {agent.name}
                    {choices.some(
                      (other) =>
                        other.id !== agent.id && other.name === agent.name,
                    ) && (
                      <span className="block text-xs text-muted-foreground">
                        {agent.id}
                      </span>
                    )}
                  </span>
                  {agent.missing && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Not found
                    </span>
                  )}
                </label>
              ))}
              {!matches.length && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {query ? "No matching agents." : "No agents found."}
                </p>
              )}
            </div>
          )}
          {error ? (
            <p
              id={`${groupId}-error`}
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground" role="status">
              {selectedIds.length} selected
            </p>
          )}
        </>
      )}
    </div>
  );
}
