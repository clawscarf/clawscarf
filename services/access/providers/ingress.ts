import {
  createServer,
  STATUS_CODES,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  createServer as createHttpsServer,
  type ServerOptions as TlsOptions,
} from "node:https";
import { Socket } from "node:net";
import { createProxyServer } from "httpxy";
import { parseCookie } from "cookie";
import { AccessError } from "../types/errors.js";
import { SessionStreams, type TrackedStream } from "./streams.js";
import type {
  CompanionApiRoute,
  IngressAuthority,
  RuntimeRoute,
} from "../types/ingress.js";
export function cleanHeaders(
  headers: IncomingMessage["headers"],
  nativeHook = false,
) {
  for (const name of Object.keys(headers))
    if (
      (!nativeHook && name === "authorization") ||
      name === "cookie" ||
      name === "x-openclaw-user" ||
      name === "x-openclaw-scopes" ||
      (!nativeHook && name === "x-openclaw-token") ||
      name === "x-real-ip" ||
      name === "forwarded" ||
      name.startsWith("x-forwarded-") ||
      name.startsWith("x-clawscarf-")
    )
      delete headers[name];
}
/** Adapts RawClaw's streaming proxy to one configured server, without fleet lookup. */
export function createIngress(
  authority: IngressAuthority,
  routes: readonly RuntimeRoute[],
  localLogin: boolean,
  handleAccess: (request: IncomingMessage, response: ServerResponse) => void,
  tls: { management?: TlsOptions; application?: TlsOptions } = {},
  companionApi?: CompanionApiRoute,
) {
  if (companionApi) {
    const origin = new URL(companionApi.origin);
    const prefix = new URL(companionApi.pathPrefix, origin);
    if (
      !tls.management ||
      origin.protocol !== "https:" ||
      origin.origin !== companionApi.origin ||
      routes.some((route) => new URL(route.origin).host === origin.host) ||
      !companionApi.pathPrefix.startsWith("/_clawscarf/") ||
      !companionApi.pathPrefix.endsWith("/") ||
      prefix.origin !== origin.origin ||
      prefix.pathname !== companionApi.pathPrefix ||
      prefix.search ||
      prefix.hash
    )
      throw new Error(
        "The companion API requires a distinct HTTPS management origin and exact companion path prefix.",
      );
  }
  const streams = new SessionStreams(authority);
  const timer = setInterval(() => streams.tick(), 2000);
  timer.unref();
  async function forward(
    req: IncomingMessage,
    res: ServerResponse | Socket,
    head?: Buffer,
    management = false,
  ) {
    let stream: TrackedStream | undefined;
    try {
      const host = req.headers.host ?? "",
        path = req.url ?? "/";
      if (!path.startsWith("/") || path.startsWith("//"))
        throw new AccessError("forbidden", "Invalid request.");
      if (companionApi && new URL(companionApi.origin).host === host) {
        const url = new URL(path, companionApi.origin);
        if (
          !management ||
          res instanceof Socket ||
          url.host !== host ||
          !url.pathname.startsWith(companionApi.pathPrefix)
        )
          throw new AccessError("forbidden", "Invalid companion API route.");
        handleAccess(req, res);
        return;
      }
      const route = routes.find((r) => new URL(r.origin).host === host);
      if (!route) throw new AccessError("forbidden", "Unknown server.");
      const url = new URL(path, route.origin);
      if (url.host !== host)
        throw new AccessError("forbidden", "Invalid request.");
      if (url.pathname.startsWith("/_clawscarf")) {
        if (route.kind !== "application" || res instanceof Socket)
          throw new AccessError("forbidden", "Invalid access route.");
        handleAccess(req, res);
        return;
      }
      const nativeHook =
        route.kind === "application" &&
        !(res instanceof Socket) &&
        req.method === "POST" &&
        route.webhookPaths?.includes(url.pathname) === true;
      const proxy = createProxyServer({
        proxyTimeout: 0,
        timeout: 0,
        followRedirects: false,
      });
      const requests = new Set<import("node:http").ClientRequest>(),
        sockets = new Set<Socket>();
      let stopped = false;
      const selected: TrackedStream = {
        session: parseCookie(req.headers.cookie ?? "").clawscarf_session ?? "",
        identity: null,
        checkedAt: performance.now(),
        close() {
          if (stopped) return;
          stopped = true;
          for (const request of requests) request.destroy();
          for (const socket of sockets) socket.destroy();
          if (res instanceof Socket || !res.writableFinished) res.destroy();
          streams.active.delete(selected);
        },
      };
      stream = selected;
      res.once("close", () => selected.close());
      res.once("error", () => selected.close());
      if (route.kind === "application" && !nativeHook) {
        streams.active.add(selected);
        selected.identity = (
          await authority.authenticate(selected.session)
        ).identity;
        selected.checkedAt = performance.now();
      }
      if (stopped) return;
      const clientAddress = req.socket.remoteAddress ?? "";
      cleanHeaders(req.headers, nativeHook);
      req.headers.host = new URL(route.upstream).host;
      if (selected.identity) req.headers["x-openclaw-user"] = selected.identity;
      req.headers["x-forwarded-host"] = host;
      req.headers["x-forwarded-proto"] = new URL(route.origin).protocol.slice(
        0,
        -1,
      );
      req.headers["x-forwarded-for"] = clientAddress;
      const prepared = (request: import("node:http").ClientRequest) => {
        requests.add(request);
        const timeout = setTimeout(
          () =>
            request.destroy(
              Object.assign(new Error("Connection timed out"), {
                code: "ETIMEDOUT",
              }),
            ),
          10000,
        );
        request.once("socket", (socket) => {
          if (!socket.connecting) clearTimeout(timeout);
          else socket.once("connect", () => clearTimeout(timeout));
        });
        request.once("response", () => clearTimeout(timeout));
        request.once("upgrade", () => clearTimeout(timeout));
        request.once("close", () => {
          clearTimeout(timeout);
          requests.delete(request);
        });
      };
      proxy.on("proxyReq", prepared);
      proxy.on("proxyReqWs", prepared);
      proxy.on("open", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
        if (stopped) socket.destroy();
      });
      if (res instanceof Socket)
        await proxy.ws(req, res, { target: route.upstream }, head);
      else await proxy.web(req, res, { target: route.upstream });
    } catch (error) {
      const status =
        error instanceof AccessError
          ? error.code === "unauthenticated"
            ? 401
            : 403
          : 503;
      if (res instanceof Socket) {
        if (!res.destroyed)
          res.end(
            `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
          );
      } else if (!res.headersSent && !res.destroyed) {
        if (
          status === 401 &&
          req.method === "GET" &&
          req.headers.accept?.includes("text/html")
        )
          res.writeHead(302, {
            Location: localLogin
              ? `/_clawscarf/local-sign-in?returnTo=${encodeURIComponent(req.url ?? "/")}`
              : `/_clawscarf/login?returnTo=${encodeURIComponent(req.url ?? "/")}`,
            "Cache-Control": "no-store",
          });
        else res.writeHead(status, { "Cache-Control": "no-store" });
        res.end();
      } else stream?.close();
      if (stream) streams.active.delete(stream);
    }
  }
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    void forward(req, res);
  };
  const server = tls.application
    ? createHttpsServer(tls.application, handler)
    : createServer(handler);
  const managementServer = tls.management
    ? createHttpsServer(tls.management, (req, res) => {
        void forward(req, res, undefined, true);
      })
    : undefined;
  const servers = managementServer ? [server, managementServer] : [server];
  for (const listener of servers)
    listener.on("upgrade", (req, socket, head) => {
      if (socket instanceof Socket)
        void forward(req, socket, head, listener === managementServer);
      else socket.destroy();
    });
  return {
    server,
    managementServer,
    streams,
    async close() {
      clearInterval(timer);
      streams.close();
      await Promise.all(
        servers.map((listener) =>
          listener.listening
            ? new Promise<void>((resolve, reject) =>
                listener.close((error) => (error ? reject(error) : resolve())),
              )
            : Promise.resolve(),
        ),
      );
    },
  };
}
