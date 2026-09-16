import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import * as api from "../generated/client/sdk.gen.js";
import { request, problem } from "./request.js";
import { Loading } from "./loading.js";
import { People } from "./people.js";
import { Button } from "../../../ui/shadcn/components/ui/button.js";
export function App() {
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
