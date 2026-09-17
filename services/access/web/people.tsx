import { RefreshCw } from "lucide-react";
import type { NavigationLink } from "../generated/types.gen.js";
import { problem } from "./request.js";
import { Loading } from "./loading.js";
import { usePeopleState } from "./people-state.js";
import { PeopleDialogs } from "./people-dialogs.js";
import { Button } from "../../../ui/shadcn/components/ui/button.js";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../../ui/shadcn/components/ui/table.js";
export function People({
  csrfToken,
  enrollmentEnabled,
  links,
}: {
  csrfToken: string;
  enrollmentEnabled: boolean;
  links: NavigationLink[];
}) {
  const state = usePeopleState(csrfToken);
  const {
    people,
    change,
    prepare,
    authorized,
    canEnroll,
    busy,
    adding,
    setAdding,
    removing,
    setRemoving,
  } = state;
  const setup =
    authorized && enrollmentEnabled && people.data?.enrollment !== "ready" ? (
      <div className="space-y-3">
        {people.data?.enrollment === "preparation_required" ? (
          <>
            <p className="text-sm">Enable team access before adding people.</p>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                change.reset();
                prepare.mutate();
              }}
            >
              Enable team access
            </Button>
          </>
        ) : (
          <p role="alert" className="text-sm">
            Review team roles in OpenClaw before adding people.
          </p>
        )}
        {prepare.isPending && <Loading text="Enabling team access…" />}
      </div>
    ) : null;
  const failure = people.error ?? change.error ?? prepare.error;
  return (
    <section className="space-y-4">
      {authorized && links.length > 0 && (
        <nav aria-label="Server management" className="flex gap-4 text-sm">
          <span aria-current="page" className="font-medium">
            People
          </span>
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>
      )}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">People</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={people.isFetching}
            onClick={() => {
              void people.refetch();
            }}
          >
            <RefreshCw />
            Refresh
          </Button>
          {enrollmentEnabled && canEnroll && (
            <Button
              disabled={busy}
              onClick={() => {
                change.reset();
                setAdding(true);
              }}
            >
              Add person
            </Button>
          )}
        </div>
      </div>
      {people.isFetching && (
        <Loading
          text={
            people.data
              ? "Refreshing access…"
              : "Checking administrator access…"
          }
        />
      )}
      {failure && !adding && !removing && (
        <p role="alert" className="text-sm text-destructive">
          {problem(failure).detail ?? "Access could not be loaded."}
        </p>
      )}
      {!adding && setup}
      {change.isPending && !adding && !removing && (
        <Loading text="Updating access…" />
      )}
      {people.data && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="hidden sm:table-cell">Email</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.data.people.map((person) => (
                <TableRow key={person.id}>
                  <TableCell className="max-w-48 whitespace-normal break-words sm:max-w-none">
                    <span>{person.name}</span>
                    <span className="mt-1 block text-xs text-muted-foreground sm:hidden">
                      {person.email}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {person.email}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      disabled={!authorized || busy}
                      onClick={() => {
                        change.reset();
                        setRemoving(person);
                      }}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <PeopleDialogs
        state={state}
        csrfToken={csrfToken}
        setup={setup}
        failure={failure}
      />
    </section>
  );
}
