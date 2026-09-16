import { useCallback } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Connection, Connector } from "../../../generated/types.gen.js";
import { api, data, request, requestSignal } from "../../shared/api/client.js";
export const connectionPath = (connection: Pick<Connection, "id">) => ({
  connectionId: connection.id,
});
export function setupPending(connection: Connection) {
  return (
    connection.setup !== null &&
    ["creating", "pending", "verifying"].includes(connection.setup.state)
  );
}
const workPending = (connection: Connection) =>
  setupPending(connection) || connection.cleanup === "pending";
export function useConnectorCatalog() {
  return useQuery({
    queryKey: ["connector-catalog"],
    retry: false,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const items: Connector[] = [];
      const visited = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await data(
          api.listConnectors({
            ...request,
            query: { limit: 100, ...(cursor ? { cursor } : {}) },
            signal: requestSignal(signal),
          }),
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        if (cursor) {
          if (visited.has(cursor))
            throw Error("Couldn’t finish loading services. Try again.");
          visited.add(cursor);
        }
      } while (cursor);
      return items;
    },
  });
}
export function useConnections() {
  return useInfiniteQuery({
    queryKey: ["connections", "list"],
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      data(
        api.listConnections({
          ...request,
          query: {
            limit: 100,
            includeDisconnected: true,
            ...(pageParam ? { cursor: pageParam } : {}),
          },
          signal: requestSignal(signal),
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: (query) =>
      !query.state.error &&
      query.state.data?.pages.some((page) => page.items.some(workPending))
        ? 2000
        : false,
  });
}
export function useConnection(connectionId: string) {
  return useQuery({
    queryKey: ["connections", "detail", connectionId],
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      data(
        api.getConnection({
          ...request,
          path: { connectionId },
          signal: requestSignal(signal),
        }),
      ),
    refetchInterval: (query) =>
      !query.state.error && query.state.data && workPending(query.state.data)
        ? 2000
        : false,
  });
}
export function useRefreshConnectionMetadata() {
  const cache = useQueryClient();
  return useCallback(
    () => cache.invalidateQueries({ queryKey: ["connections"] }),
    [cache],
  );
}
/** Redirect only the setup explicitly started or resumed by this browser. */
export function useConnectionHandoff(
  connectionId: string,
  setupId: string | null,
) {
  return useQuery({
    queryKey: ["connection-handoff", connectionId, setupId],
    enabled: setupId !== null,
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => {
      if (!setupId) throw Error("Choose a setup to continue.");
      return data(
        api.getConnectionSetup({
          ...request,
          path: { connectionId, setupId },
          signal: requestSignal(signal),
        }),
      );
    },
    refetchInterval: (query) =>
      !query.state.error && query.state.data?.setup.state === "creating"
        ? 1000
        : false,
  });
}
export function useConnectionAgents(enabled: boolean) {
  return useQuery({
    queryKey: ["connection-agents"],
    enabled,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      data(
        api.listConnectionAgents({
          ...request,
          signal: requestSignal(signal, 180_000),
        }),
      ),
  });
}
