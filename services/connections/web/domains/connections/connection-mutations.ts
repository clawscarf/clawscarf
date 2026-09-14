import { useMutation } from "@tanstack/react-query";
import type {
  Connection,
  CreateConnection,
  StartConnectionSetup,
  UpdateConnection,
} from "../../../generated/client/types.gen.js";
import { api, data, request } from "../../shared/api/client.js";
import {
  connectionPath,
  useRefreshConnectionMetadata,
} from "./connection-queries.js";

export const connectionRevision = (revision: number) => ({
  "if-match": `"${revision}"`,
});

export function useCreateConnection() {
  const refresh = useRefreshConnectionMetadata();
  return useMutation({
    retry: false,
    mutationFn: ({ input, key }: { input: CreateConnection; key: string }) =>
      data(
        api.createConnection({
          ...request,
          signal: AbortSignal.timeout(20_000),
          body: input,
          headers: { "idempotency-key": key },
        }),
      ),
    onSettled: () => {
      void refresh();
    },
  });
}

export function useUpdateConnection() {
  const refresh = useRefreshConnectionMetadata();
  return useMutation({
    retry: false,
    mutationFn: ({
      connection,
      input,
      key,
    }: {
      connection: Connection;
      input: UpdateConnection;
      key: string;
    }) =>
      data(
        api.updateConnection({
          ...request,
          signal: AbortSignal.timeout(200_000),
          path: connectionPath(connection),
          body: input,
          headers: {
            ...connectionRevision(connection.revision),
            "idempotency-key": key,
          },
        }),
      ),
    onSettled: () => {
      void refresh();
    },
  });
}

export function useStartConnectionSetup() {
  const refresh = useRefreshConnectionMetadata();
  return useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: ({
      connection,
      kind,
      key,
    }: {
      connection: Connection;
      kind: StartConnectionSetup["kind"];
      key: string;
    }) =>
      data(
        api.startConnectionSetup({
          ...request,
          signal: AbortSignal.timeout(20_000),
          path: connectionPath(connection),
          body: { kind },
          headers: {
            ...connectionRevision(connection.revision),
            "idempotency-key": key,
          },
        }),
      ),
    onSettled: () => {
      void refresh();
    },
  });
}

export function useCancelConnectionSetup() {
  const refresh = useRefreshConnectionMetadata();
  return useMutation({
    retry: false,
    mutationFn: ({
      connection,
      setupId,
      key,
    }: {
      connection: Connection;
      setupId: string;
      key: string;
    }) =>
      data(
        api.cancelConnectionSetup({
          ...request,
          signal: AbortSignal.timeout(20_000),
          path: {
            ...connectionPath(connection),
            setupId,
          },
          headers: {
            ...connectionRevision(connection.revision),
            "idempotency-key": key,
          },
        }),
      ),
    onSettled: () => {
      void refresh();
    },
  });
}

export function useRefreshConnection() {
  const refresh = useRefreshConnectionMetadata();
  return useMutation({
    retry: false,
    mutationFn: ({
      connection,
      key,
    }: {
      connection: Connection;
      key: string;
    }) =>
      data(
        api.refreshConnection({
          ...request,
          signal: AbortSignal.timeout(200_000),
          path: connectionPath(connection),
          headers: {
            ...connectionRevision(connection.revision),
            "idempotency-key": key,
          },
        }),
      ),
    onSettled: () => {
      void refresh();
    },
  });
}

export function useDisconnectConnection() {
  const refresh = useRefreshConnectionMetadata();
  return useMutation({
    retry: false,
    mutationFn: ({
      connection,
      key,
    }: {
      connection: Connection;
      key: string;
    }) =>
      data(
        api.disconnectConnection({
          ...request,
          signal: AbortSignal.timeout(200_000),
          path: connectionPath(connection),
          headers: {
            ...connectionRevision(connection.revision),
            "idempotency-key": key,
          },
        }),
      ),
    onSettled: () => {
      void refresh();
    },
  });
}
