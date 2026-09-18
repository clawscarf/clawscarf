import { z } from "zod";
export const defaultCloudUrl = "https://cloud.clawscarf.com";
export const cloudUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.origin === value &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  );
}, "Use an HTTPS origin, or loopback HTTP for development.");
