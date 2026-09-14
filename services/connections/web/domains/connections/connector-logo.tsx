import { useState } from "react";
import { Plug } from "lucide-react";
import { cn } from "../../shared/shadcn/lib/utils.js";

export function ConnectorLogo({
  iconUrl,
  className,
}: {
  iconUrl: string | null;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground",
        className,
      )}
    >
      <Plug className="size-4" />
      {iconUrl && failedUrl !== iconUrl && (
        <img
          alt=""
          className={cn(
            "absolute inset-0 size-full bg-background object-contain p-1.5",
            loadedUrl !== iconUrl && "opacity-0",
          )}
          onError={() => setFailedUrl(iconUrl)}
          onLoad={() => setLoadedUrl(iconUrl)}
          referrerPolicy="no-referrer"
          src={iconUrl}
        />
      )}
    </span>
  );
}
