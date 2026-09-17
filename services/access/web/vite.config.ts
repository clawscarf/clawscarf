import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/_clawscarf/team/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/_clawscarf/session": "http://127.0.0.1:18800",
      "/_clawscarf/people": "http://127.0.0.1:18800",
      "^/_clawscarf/team$": "http://127.0.0.1:18800",
      "/_clawscarf/logout": "http://127.0.0.1:18800",
      "/_clawscarf/login": "http://127.0.0.1:18800",
      "/_clawscarf/callback": "http://127.0.0.1:18800",
      "/_clawscarf/local": "http://127.0.0.1:18800",
      "/_clawscarf/signed-out": "http://127.0.0.1:18800",
    },
  },
});
