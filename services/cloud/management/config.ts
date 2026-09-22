import { z } from "zod";
const origin = z.url().refine((value) => {
  const u = new URL(value);
  return (
    u.origin === value &&
    (u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
  );
}, "Use an exact HTTPS Cloud origin, or HTTP on loopback for tests.");
export const cloudServiceSchema = z.strictObject({
  id: z.uuid(),
  accountId: z.uuid(),
  url: origin,
  managementKeyFile: z.string().min(1),
  ai: z.boolean(),
  connections: z.boolean(),
});
export const cloudServicesSchema = z
  .array(cloudServiceSchema)
  .max(2)
  .refine(
    (values) => new Set(values.map((value) => value.id)).size === values.length,
    "Cloud installation IDs must be unique.",
  );
export type CloudService = z.infer<typeof cloudServiceSchema>;
