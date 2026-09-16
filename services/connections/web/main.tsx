import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
} from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { logout, session } from "../../access/generated/client/sdk.gen.js";
import {
  api,
  request,
  data,
  setCsrfToken,
  ApiError,
} from "./shared/api/client.js";
import { ConnectionsPage } from "./domains/connections/connections-page.js";
import { ConnectionReturnPage } from "./domains/connections/connection-return.js";
import { Loading, Feedback } from "./shared/ui/feedback.js";
import { Button } from "../../../ui/shadcn/components/ui/button.js";
import "../../../ui/theme.css";

function SessionBoundary({ children }: { children: ReactNode }) {
  const current = useQuery({
    queryKey: ["session"],
    retry: false,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const result = await data(session({ ...request, signal }));
      setCsrfToken(result.csrfToken);
      return result;
    },
  });
  const signOut = useMutation({
    mutationFn: async () => {
      if (!current.data) return;
      const result = await data(logout({ ...request }));
      window.location.assign(result.redirect);
    },
  });
  useEffect(() => {
    if (
      current.error instanceof ApiError &&
      current.error.problem.status === 401
    ) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.replace(
        `/_clawscarf/login?returnTo=${encodeURIComponent(returnTo)}`,
      );
    }
  }, [current.error]);
  return (
    <>
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
      {signOut.isPending && <Loading label="Signing out…" />}
      {signOut.error && <Feedback error message={signOut.error.message} />}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Connections</h2>
        {current.isPending ? (
          <Loading label="Signing in…" />
        ) : current.error ? (
          <>
            <Feedback error message={current.error.message} />
            <Button
              variant="outline"
              onClick={() => {
                void current.refetch();
              }}
            >
              Try again
            </Button>
          </>
        ) : (
          children
        )}
      </section>
    </>
  );
}
function Home() {
  const status = useQuery({
    queryKey: ["connection-capabilities"],
    retry: false,
    queryFn: ({ signal }) =>
      data(api.getConnectionCapabilities({ ...request, signal })),
  });
  if (status.isPending) return <Loading label="Loading connections…" />;
  if (status.error) return <Feedback error message={status.error.message} />;
  return status.data.enabled ? (
    <ConnectionsPage />
  ) : (
    <p className="text-sm text-muted-foreground">
      Connections are not enabled on this server.
    </p>
  );
}
const queryClient = new QueryClient({
  defaultOptions: { mutations: { retry: false } },
});
const element = document.getElementById("root");
if (!element) throw Error("Missing application root.");
createRoot(element).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/_clawscarf/connections">
        <main className="shadcn-root mx-auto max-w-6xl space-y-8 px-5 py-8 sm:px-8 sm:py-12">
          <SessionBoundary>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route
                path="/return/:returnId?"
                element={<ConnectionReturnPage />}
              />
            </Routes>
          </SessionBoundary>
        </main>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
