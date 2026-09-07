import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, webRuntime } from "@threadflow-os/client-ui";
import "@threadflow-os/client-ui/style.css";
import "./web.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App runtime={webRuntime} />
    </QueryClientProvider>
  </React.StrictMode>,
);
