import type { ReactNode } from "react";
import * as api from "../generated/sdk.gen.js";
import { request, problem } from "./request.js";
import { Loading } from "./loading.js";
import type { PeopleState } from "./people-state.js";
import { Button } from "../../../ui/shadcn/components/ui/button.js";
import { Input } from "../../../ui/shadcn/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../../ui/shadcn/components/ui/dialog.js";
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
export function PeopleDialogs({
  state,
  csrfToken,
  setup,
  failure,
}: {
  state: PeopleState;
  csrfToken: string;
  setup: ReactNode;
  failure: unknown;
}) {
  const {
    change,
    authorized,
    canEnroll,
    busy,
    adding,
    setAdding,
    removing,
    setRemoving,
  } = state;
  const headers = { "x-csrf-token": csrfToken };
  return (
    <>
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
            {setup}
            {change.isPending && <Loading text="Adding person…" />}
            {Boolean(failure) && (
              <p role="alert" className="text-sm text-destructive">
                {problem(failure).detail ?? "Could not add this person."}
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
              <Button disabled={!canEnroll || busy}>Add person</Button>
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
          {Boolean(failure) && (
            <p role="alert" className="text-sm text-destructive">
              {problem(failure).detail ?? "Could not remove this person."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!authorized || busy}
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
    </>
  );
}
