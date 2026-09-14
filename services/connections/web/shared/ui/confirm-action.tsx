import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "../shadcn/components/ui/alert-dialog.js";
import { Button } from "../shadcn/components/ui/button.js";
import { Feedback } from "./feedback.js";

export function ConfirmAction({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error?: string | undefined;
  onConfirm: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Feedback message={error} error />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Please wait…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
