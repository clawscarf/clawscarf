import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api, data, request } from "../../shared/api/client.js";
import { Button } from "../../../../../ui/shadcn/components/ui/button.js";
import { Feedback } from "../../shared/ui/feedback.js";

function ReturnLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="grid min-h-svh place-items-center bg-sidebar px-6 py-12"
    >
      <div className="w-full max-w-md space-y-6">
        <p className="text-sm font-semibold tracking-tight">ClawScarf</p>
        <div className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
          {children}
        </div>
      </div>
    </main>
  );
}

function returnFailure(error: Error) {
  if (error instanceof ApiError) {
    if (error.problem.code === "connector_provider_authentication")
      return {
        message: "Connection setup is unavailable. Contact your administrator.",
        retry: false,
      };
    if ([400, 404, 410].includes(error.problem.status))
      return {
        message:
          "This connection link is no longer available. Return to Connections to continue setup.",
        retry: false,
      };
    if (error.problem.status === 403)
      return {
        message: "You don't have access to finish this connection.",
        retry: false,
      };
    if (error.problem.code === "connection_callback_used")
      return {
        message:
          "We couldn't confirm this connection. To start again, cancel its pending setup in Connections.",
        retry: false,
      };
    if (error.problem.code === "connection_setup_expired")
      return {
        message:
          "This setup has expired. Return to Connections to start again.",
        retry: false,
      };
  }
  return {
    message:
      "We couldn't confirm the connection. Try again to check its status.",
    retry: true,
  };
}

export function ConnectionReturnUnavailable() {
  return (
    <ReturnLayout>
      <h1 className="text-xl font-semibold tracking-tight">
        Connection unavailable
      </h1>
      <p className="text-sm text-muted-foreground">
        We couldn't open this connection. Return to Connections to continue
        setup.
      </p>
      <Button asChild variant="outline">
        <Link to="/">Back to ClawScarf</Link>
      </Button>
    </ReturnLayout>
  );
}

export function ConnectionReturnPage() {
  const { returnId } = useParams();
  return returnId ? (
    <ConnectionReturn key={returnId} returnId={returnId} />
  ) : (
    <ConnectionReturnUnavailable />
  );
}

function ConnectionReturn({ returnId }: { returnId: string }) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const complete = useMutation({
    mutationFn: () =>
      data(
        api.completeConnectionReturn({
          ...request,
          path: { returnId },
          signal: AbortSignal.timeout(200_000),
        }),
      ),
    retry: false,
    onError: async (error) => {
      if (error instanceof ApiError && error.problem.status === 401)
        await cache.invalidateQueries({ queryKey: ["session"] });
    },
  });
  const { mutate } = complete;
  const finish = useCallback(() => {
    mutate(undefined, {
      onSuccess: () => {
        void navigate("/", { replace: true });
      },
    });
  }, [mutate, navigate]);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    finish();
  }, [finish]);
  const failure = complete.error ? returnFailure(complete.error) : null;
  return (
    <ReturnLayout>
      <h1 className="text-xl font-semibold tracking-tight">
        {failure ? "Connection needs attention" : "Connecting…"}
      </h1>
      {failure ? (
        <Feedback error message={failure.message} />
      ) : (
        <div
          role="status"
          className="flex items-center gap-3 text-sm text-muted-foreground"
        >
          <LoaderCircle
            aria-hidden="true"
            className="size-5 animate-spin motion-reduce:animate-none"
          />
          Checking connection…
        </div>
      )}
      {failure?.retry && (
        <Button
          className="w-full"
          disabled={complete.isPending}
          onClick={finish}
        >
          Try again
        </Button>
      )}
      <Button asChild variant="ghost" className="w-full">
        <Link to="/">Back to ClawScarf</Link>
      </Button>
    </ReturnLayout>
  );
}
