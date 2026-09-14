import { useEffect, useState } from "react";
import { Check, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "../shadcn/components/ui/alert.js";
import { Skeleton } from "../shadcn/components/ui/skeleton.js";

export function Feedback({
  message,
  error = false,
  success = false,
}: {
  message?: string | undefined;
  error?: boolean;
  success?: boolean;
}) {
  if (!message) return null;
  const Icon = error ? TriangleAlert : success ? Check : Info;
  return (
    <Alert
      role={error ? "alert" : "status"}
      variant={error ? "destructive" : "default"}
    >
      <Icon aria-hidden="true" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** One visible status per affected resource; callers keep cached content mounted. */
export function ReadProgress({
  active,
  label = "Updating…",
}: {
  active: boolean;
  label?: string;
}) {
  return active ? <ProgressMessage label={label} /> : null;
}
function ProgressMessage({ label }: { label: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div
      role="status"
      className="flex items-center gap-2 py-2 text-sm text-muted-foreground"
    >
      <LoaderCircle
        aria-hidden="true"
        className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
      />
      <span>
        {label}
        {slow && (
          <span className="block text-xs">
            Taking longer than usual. Still waiting for a response…
          </span>
        )}
      </span>
    </div>
  );
}
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="space-y-4 py-4" aria-busy="true">
      <ProgressMessage label={label} />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}
