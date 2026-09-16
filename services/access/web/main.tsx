import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app.js";
import "./styles/theme.css";
const element = document.getElementById("root");
if (!element) throw Error("Missing application root.");
createRoot(element).render(
  <StrictMode>
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
