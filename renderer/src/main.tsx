import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./i18n";
import { App } from "./app/App";
import "./styles/global.css";
import "./styles/components.css";
import "./styles/model-library.css";
import "./styles/outfit-library.css";
import "./styles/library-asset-picker.css";
import "./styles/free-canvas.css";
import "./styles/image-review.css";
import "./styles/infinite-canvas.css";
import "./styles/responsive.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 20_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
