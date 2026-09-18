/** Explicit OIDC profile for deployment fixtures; no identity server is contacted. */
export function oidcTeam(application: number, widgets: number) {
  return {
    origin: `http://127.0.0.1:${String(application)}`,
    widgetOrigin: `http://127.0.0.1:${String(widgets)}`,
    issuer: "https://identity.example.test",
    clientId: "fixture",
    clientSecretFile: "/private/oidc-client-secret",
  };
}
