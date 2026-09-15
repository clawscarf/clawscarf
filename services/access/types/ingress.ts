export interface IngressIdentity {
  identity: string;
}
export interface RuntimeRoute {
  origin: string;
  upstream: string;
  kind: "application" | "widget";
  webhookPaths?: readonly string[];
}
/** Companion-owned HTTP prefix on a distinct management TLS origin; never a native upstream. */
export interface CompanionApiRoute {
  origin: string;
  pathPrefix: string;
}
export interface IngressAuthority {
  authenticate(session: string): Promise<IngressIdentity>;
}
