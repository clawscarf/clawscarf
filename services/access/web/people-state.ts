import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "../generated/client/sdk.gen.js";
import type { User } from "../generated/client/types.gen.js";
import { request } from "./request.js";
export function usePeopleState(csrfToken: string) {
  const cache = useQueryClient();

  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<User | null>(null);
  const people = useQuery({
    queryKey: ["people"],
    retry: false,
    queryFn: async ({ signal }) =>
      (await api.listPeople({ ...request, signal })).data,
  });
  const change = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onError: () => cache.invalidateQueries({ queryKey: ["people"] }),
    onSuccess: async () => {
      setAdding(false);
      setRemoving(null);
      await cache.invalidateQueries({ queryKey: ["people"] });
    },
  });
  const prepare = useMutation({
    mutationFn: () =>
      api.prepareTeam({ ...request, headers: { "x-csrf-token": csrfToken } }),
    onError: () => cache.invalidateQueries({ queryKey: ["people"] }),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["people"] }),
  });
  const authorized = !!people.data && !people.isError;
  const canEnroll = authorized && people.data?.enrollment === "ready";
  const busy = change.isPending || prepare.isPending;
  return {
    people,
    change,
    prepare,
    authorized,
    canEnroll,
    busy,
    adding,
    setAdding,
    removing,
    setRemoving,
  };
}
export type PeopleState = ReturnType<typeof usePeopleState>;
