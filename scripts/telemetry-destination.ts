import { z } from "zod";

export const destinationSchema = z.strictObject({
  host: z.url().refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && url.hostname === "127.0.0.1"))
    );
  }),
  projectToken: z.string().regex(/^phc_[A-Za-z0-9_-]+$/),
});
