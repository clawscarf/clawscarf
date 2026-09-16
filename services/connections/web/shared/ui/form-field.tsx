import { useId, type ReactNode } from "react";
import { Label } from "../../../../../ui/shadcn/components/ui/label.js";

export function FormField({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: (input: { id: string; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        ...(description ? { "aria-describedby": `${id}-description` } : {}),
      })}
      {description && (
        <p
          id={`${id}-description`}
          className="text-xs leading-5 text-muted-foreground"
        >
          {description}
        </p>
      )}
    </div>
  );
}
