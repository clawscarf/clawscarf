import { RefreshCw } from "lucide-react";
import { Button } from "../shadcn/components/ui/button.js";

/** Stable label and dimensions across resource toolbars, including pending reads. */
export function RefreshButton({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={refreshing}
      aria-busy={refreshing}
      onClick={onRefresh}
    >
      <RefreshCw
        aria-hidden="true"
        className={
          refreshing ? "animate-spin motion-reduce:animate-none" : undefined
        }
      />
      Refresh
    </Button>
  );
}
