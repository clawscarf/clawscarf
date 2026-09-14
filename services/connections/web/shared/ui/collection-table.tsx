import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "../shadcn/components/ui/button.js";
import { Input } from "../shadcn/components/ui/input.js";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
} from "../shadcn/components/ui/table.js";

/** A bounded view over an observed collection; resource fetching stays with the feature. */
export function CollectionTable<T>({
  label,
  items,
  searchText,
  headers,
  columns,
  renderRow,
  actions,
  footer,
  empty = "No results.",
  searchLabel = `Search ${label.toLowerCase()}`,
}: {
  label: string;
  items: readonly T[];
  searchText: (item: T) => string;
  headers: ReactNode;
  columns: number;
  renderRow: (item: T) => ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  empty?: string;
  searchLabel?: string;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const matches = items.filter((item) =>
    searchText(item)
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(matches.length / 10));
  const current = Math.min(page, pages - 1);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label={searchLabel}
            placeholder={searchLabel}
            className="pl-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border">
        <Table aria-label={label}>
          <TableHeader>
            <TableRow>{headers}</TableRow>
          </TableHeader>
          <TableBody>
            {matches.slice(current * 10, (current + 1) * 10).map(renderRow)}
            {!matches.length && (
              <TableRow>
                <TableCell
                  colSpan={columns}
                  className="h-32 text-center text-muted-foreground"
                >
                  {search ? "No matching results." : empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span role="status">
          {matches.length
            ? `${current * 10 + 1}–${Math.min((current + 1) * 10, matches.length)} of ${matches.length}`
            : "0 results"}
        </span>
        {footer}
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={`Previous ${label.toLowerCase()} page`}
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span>
              Page {current + 1} of {pages}
            </span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={`Next ${label.toLowerCase()} page`}
              disabled={current + 1 === pages}
              onClick={() => setPage(current + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
