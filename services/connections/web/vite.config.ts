import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/_clawscarf/connections/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/_clawscarf/session": "http://127.0.0.1:3000",
      "/_clawscarf/connections/v1": "http://127.0.0.1:3000",
      "/_clawscarf/logout": "http://127.0.0.1:3000",
      "/_clawscarf/login": "http://127.0.0.1:3000",
    },
  },
});
