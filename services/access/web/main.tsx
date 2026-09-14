import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { LoaderCircle, RefreshCw } from "lucide-react";
import * as api from "../generated/client/sdk.gen.js";
import type {
  Problem,
  User,
  NavigationLink,
} from "../generated/client/types.gen.js";
import { Button } from "./shared/shadcn/components/ui/button.js";
import { Input } from "./shared/shadcn/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./shared/shadcn/components/ui/dialog.js";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./shared/shadcn/components/ui/table.js";
import "./styles/theme.css";
const request = {
  baseUrl: window.location.origin,
  credentials: "same-origin",
  throwOnError: true,
} as const;
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
function problem(error: unknown): Partial<Problem> {
  return typeof error === "object" && error !== null ? error : {};
}
function Loading({ text }: { text: string }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <LoaderCircle className="size-4 animate-spin" />
      {text}
    </p>
  );
}
function People({
  csrfToken,
  enrollmentEnabled,
  links,
}: {
  csrfToken: string;
  enrollmentEnabled: boolean;
  links: NavigationLink[];
}) {
  const cache = useQueryClient();
  const headers = { "x-csrf-token": csrfToken };
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<User | null>(null);
  const people = useQuery({
    queryKey: ["people"],
    retry: false,
    queryFn: async ({ signal }) =>
      (await api.listPeople({ ...request, signal })).data.people,
  });
  const change = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      setAdding(false);
      setRemoving(null);
      await cache.invalidateQueries({ queryKey: ["people"] });
    },
  });
  const failure = change.error ?? people.error;
  return (
    <section className="space-y-4">
      {people.data && links.length > 0 && (
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
          {enrollmentEnabled && (
            <Button
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
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {problem(failure).detail ?? "Access could not be loaded."}
        </p>
      )}
      {problem(failure).code === "setup_required" && (
        <Button
          disabled={change.isPending}
          onClick={() =>
            change.mutate(() => api.prepareTeam({ ...request, headers }))
          }
        >
          Prepare team access
        </Button>
      )}
      {change.isPending && <Loading text="Updating access…" />}
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
              {people.data.map((person) => (
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
                      disabled={change.isPending}
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
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add person</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              change.mutate(() =>
                api.enrollPerson({
                  ...request,
                  headers,
                  body: {
                    name: field(form, "name"),
                    email: field(form, "email"),
                    subject: field(form, "subject"),
                  },
                }),
              );
            }}
          >
            <label className="block space-y-2 text-sm">
              Name
              <Input name="name" required maxLength={200} />
            </label>
            <label className="block space-y-2 text-sm">
              Email
              <Input name="email" type="email" required />
            </label>
            <label className="block space-y-2 text-sm">
              Identity provider user ID
              <Input name="subject" required maxLength={512} />
            </label>
            <p className="text-sm text-muted-foreground">
              Use the person’s subject ID from your company identity provider.
              They join as a member; change application roles in OpenClaw.
            </p>
            {change.isPending && <Loading text="Adding person…" />}
            {change.error && (
              <p role="alert" className="text-sm text-destructive">
                {problem(change.error).detail ?? "Could not add this person."}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
              <Button disabled={change.isPending}>Add person</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Their access and open connections to this server will be revoked.
          </p>
          {change.error && (
            <p role="alert" className="text-sm text-destructive">
              {problem(change.error).detail ?? "Could not remove this person."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={change.isPending}
              onClick={() => {
                if (removing)
                  change.mutate(() =>
                    api.removePerson({
                      ...request,
                      headers,
                      path: { userId: removing.id },
                    }),
                  );
              }}
            >
              Remove person
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
function App() {
  const current = useQuery({
    queryKey: ["session"],
    retry: false,
    queryFn: async ({ signal }) =>
      (await api.session({ ...request, signal })).data,
  });
  const signOut = useMutation({
    mutationFn: async () => {
      if (!current.data) return;
      const result = await api.logout({
        ...request,
        headers: { "x-csrf-token": current.data.csrfToken },
      });
      window.location.assign(result.data.redirect);
    },
  });
  useEffect(() => {
    if (problem(current.error).status === 401)
      window.location.replace(
        `/_clawscarf/login?returnTo=${encodeURIComponent(window.location.pathname)}`,
      );
  }, [current.error]);
  return (
    <main className="shadcn-root mx-auto max-w-6xl space-y-8 px-5 py-8 sm:px-8 sm:py-12">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">ClawScarf</h1>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <a href="/">OpenClaw</a>
          </Button>
          {current.data && (
            <Button
              variant="ghost"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              {signOut.isPending ? "Signing out…" : "Sign out"}
            </Button>
          )}
        </div>
      </header>
      {signOut.isPending && <Loading text="Signing out…" />}
      {signOut.error && (
        <p role="alert" className="text-sm text-destructive">
          {problem(signOut.error).detail ?? "Could not sign out. Try again."}
        </p>
      )}
      {current.isPending ? (
        <Loading text="Signing in…" />
      ) : current.error ? (
        <p role="alert">
          {problem(current.error).detail ?? "Sign-in is unavailable."}
        </p>
      ) : window.location.pathname === "/_clawscarf/account/" ? (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Your account</h2>
          <p>{current.data.user.name}</p>
          <p className="text-sm text-muted-foreground">
            {current.data.user.email}
          </p>
        </section>
      ) : (
        <People
          csrfToken={current.data.csrfToken}
          enrollmentEnabled={current.data.enrollmentEnabled}
          links={current.data.links}
        />
      )}
    </main>
  );
}
const element = document.getElementById("root");
if (!element) throw Error("Missing application root.");
createRoot(element).render(
  <StrictMode>
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
