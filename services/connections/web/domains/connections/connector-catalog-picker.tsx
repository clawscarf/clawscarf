import { useId, useState, type ReactNode } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { Badge } from "../../shared/shadcn/components/ui/badge.js";
import { Button } from "../../shared/shadcn/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../shared/shadcn/components/ui/dialog.js";
import { Input } from "../../shared/shadcn/components/ui/input.js";
import { Feedback, Loading } from "../../shared/ui/feedback.js";
import type { ConnectorChoice } from "./presentation.js";
import { ConnectorLogo } from "./connector-logo.js";

const categoryOrder = [
  "Communication",
  "Collaboration",
  "Documents & Files",
  "Productivity",
  "Project Management",
  "Scheduling",
  "CRM & Sales",
  "Support",
  "Analytics & Data",
  "Developer Tools",
  "Design & Content",
  "Finance",
  "Social & Media",
];

export type ConnectorCatalogState =
  | { status: "loading" }
  | { status: "error"; message: string; onRetry: () => void }
  | { status: "ready"; items: readonly ConnectorChoice[] };

interface ConnectorCatalogProps {
  catalog: ConnectorCatalogState;
  connectedCounts: ReadonlyMap<string, number>;
  disabled: boolean;
  onSelect: (connector: ConnectorChoice) => void;
}

export function ConnectorCatalogDialog({
  open,
  onOpenChange,
  trigger,
  onCloseAutoFocus,
  ...props
}: ConnectorCatalogProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[min(46rem,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-5xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Add connection</DialogTitle>
        </DialogHeader>
        <ConnectorCatalogPicker {...props} />
      </DialogContent>
    </Dialog>
  );
}

// Layout adapted from Kora's ExtensionCatalogPicker at 44287507be2070df8ecaf75725ed0f6616b6d15a.
export function ConnectorCatalogPicker({
  catalog,
  connectedCounts,
  disabled,
  onSelect,
}: ConnectorCatalogProps) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const items = catalog.status === "ready" ? catalog.items : [];
  const counts = new Map<string, number>();
  for (const item of items)
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  const categories = [...counts].sort(([left], [right]) => {
    const leftIndex = categoryOrder.indexOf(left);
    const rightIndex = categoryOrder.indexOf(right);
    return (
      (leftIndex < 0 ? categoryOrder.length : leftIndex) -
        (rightIndex < 0 ? categoryOrder.length : rightIndex) ||
      left.localeCompare(right)
    );
  });
  const activeCategory = categories.some(([name]) => name === category)
    ? category
    : null;
  const query = search.trim().toLocaleLowerCase();
  const results = items
    .filter((item) => !activeCategory || item.category === activeCategory)
    .filter((item) =>
      [item.name, item.description, item.category, item.id].some((value) =>
        value.toLocaleLowerCase().includes(query),
      ),
    )
    .toSorted((left, right) => left.name.localeCompare(right.name));

  if (catalog.status === "loading")
    return <Loading label="Loading services…" />;
  if (catalog.status === "error")
    return (
      <div className="space-y-3">
        <Feedback error message={catalog.message} />
        <Button type="button" variant="outline" onClick={catalog.onRetry}>
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="relative">
        <label className="sr-only" htmlFor={searchId}>
          Search services
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          className="pl-9"
          id={searchId}
          type="search"
          placeholder="Search services"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav
          aria-label="Service categories"
          className="flex min-h-0 gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-y-auto lg:pb-0"
        >
          {[[null, items.length] as const, ...categories].map(
            ([name, count]) => (
              <Button
                aria-pressed={activeCategory === name}
                className="h-8 shrink-0 justify-between gap-2 px-2 text-[0.8125rem] font-medium lg:w-full"
                key={name ?? "all"}
                onClick={() => setCategory(name)}
                type="button"
                variant={activeCategory === name ? "secondary" : "ghost"}
              >
                <span className="truncate">{name ?? "All"}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {count}
                </span>
              </Button>
            ),
          )}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
          <span className="text-xs text-muted-foreground" role="status">
            {results.length} {results.length === 1 ? "service" : "services"}
          </span>
          {results.length ? (
            <div
              aria-label="Service catalog"
              className="min-h-0 flex-1 overflow-y-auto pr-1 pb-2"
              role="region"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {results.map((connector) => {
                  const connected = connectedCounts.get(connector.id) ?? 0;
                  return (
                    <button
                      aria-label={`Connect ${connector.name}`}
                      className="group flex min-h-[7rem] flex-col justify-between gap-2 rounded-md border bg-background p-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={disabled}
                      key={connector.id}
                      onClick={() => onSelect(connector)}
                      type="button"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <ConnectorLogo iconUrl={connector.iconUrl} />
                        <span className="flex items-center gap-2">
                          {connected > 0 && (
                            <Badge variant="secondary">
                              {connected} connected
                            </Badge>
                          )}
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors group-hover:border-foreground/20 group-hover:text-foreground">
                            <Plus aria-hidden="true" className="size-3.5" />
                          </span>
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="line-clamp-1 text-sm font-semibold leading-snug">
                          {connector.name}
                        </span>
                        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground group-hover:text-accent-foreground/80">
                          {connector.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="rounded-md border bg-muted/30 px-3 py-8 text-center text-sm text-muted-foreground">
              {items.length
                ? "No services match your search."
                : "No services available."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
