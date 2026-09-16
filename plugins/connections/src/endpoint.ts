/** Broker endpoints preserve their path prefix and never carry credentials or query data. */
export function brokerEndpoint(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
      )) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      "Connections requires an HTTPS broker or a loopback development URL.",
    );
  return url.href.replace(/\/$/u, "");
}
