export const monitoredServices = [
  "models",
  "models-database",
  "companion",
  "postgres",
  "execution-relay",
  "browser",
  "browser-egress",
  "browser-node",
  "browser-node-ingress",
  "browser-node-dns",
] as const;
export type MonitoredService = (typeof monitoredServices)[number];
export const localLogNames = [
  "controller",
  "execution",
  "application",
  "widgets",
  ...monitoredServices.map((service) => `${service}-wait` as const),
] as const;
export type LocalLogFile = `${(typeof localLogNames)[number]}.log`;
export const serviceLogFile = (service: MonitoredService): LocalLogFile =>
  `${service}-wait.log`;
