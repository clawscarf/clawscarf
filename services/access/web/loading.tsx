import { LoaderCircle } from "lucide-react";
export function Loading({ text }: { text: string }) {
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
