import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./renderer/src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          const normalizedId = id.replace(/\\/g, "/");
          if (normalizedId.includes("/node_modules/react/") || normalizedId.includes("/node_modules/react-dom/") || normalizedId.includes("/node_modules/scheduler/")) return "vendor-react";
          if (normalizedId.includes("/node_modules/@xyflow/")) return "vendor-flow";
          if (normalizedId.includes("@tanstack/react-query") || normalizedId.includes("@tanstack/query-core")) return "vendor-query";
          if (normalizedId.includes("i18next") || normalizedId.includes("react-i18next")) return "vendor-i18n";
          if (normalizedId.includes("zustand") || normalizedId.includes("zundo")) return "vendor-store";
          if (normalizedId.includes("lucide-react")) return "vendor-icons";
        },
      },
    },
  },
  server: {
    port: 6981,
    watch: {
      ignored: [
        "**/.forart-data/**",
        "**/CanvasAssests/**",
        "**/dist/**",
        "**/node_modules/**",
        "**/server/node_modules/**",
      ],
    },
    proxy: {
      "/api": "http://127.0.0.1:6980",
    },
  },
});
