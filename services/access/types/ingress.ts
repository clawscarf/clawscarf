export interface IngressIdentity {
  identity: string;
}
export interface RuntimeRoute {
  origin: string;
  upstream: string;
  kind: "application" | "widget";
  webhookPaths?: readonly string[];
}
export interface IngressAuthority {
  authenticate(session: string): Promise<IngressIdentity>;
}
